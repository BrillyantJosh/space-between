// =============================================
// SANDBOX — Safe command execution for entity's projects
// =============================================

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CREATIONS_DIR = path.join(__dirname, '..', 'data', 'creations');

// =============================================
// SECURITY LIMITS
// =============================================

const LIMITS = {
  maxTimeout: 30_000,           // 30s per command
  maxStdout: 512 * 1024,        // 512KB stdout
  maxStderr: 256 * 1024,        // 256KB stderr
  maxConcurrentServices: 3,
  maxServiceMemoryMB: 128,
  portRange: { min: 4001, max: 4020 },
  maxNodeModulesSize: 50 * 1024 * 1024,  // 50MB
  maxDependencies: 30,
  healthCheckTimeout: 5000,      // 5s health check
  serviceStartupWait: 3000,      // 3s wait after start
};

// Commands that are ALLOWED
const ALLOWED_COMMANDS = ['npm', 'node', 'npx', 'python3', 'ls', 'cat', 'mkdir', 'cp', 'rm', 'echo', 'test', 'chmod'];

// Commands that are BLOCKED (even in pipes/subshells)
const BLOCKED_PATTERNS = [
  /\bcurl\b/, /\bwget\b/, /\bnc\b/, /\bnetcat\b/,
  /\bssh\b/, /\bscp\b/, /\bsftp\b/,
  /\bdocker\b/, /\bkill\b/, /\breboot\b/, /\bshutdown\b/,
  /\bpoweroff\b/, /\brm\s+-rf\s+\//, /\bdd\b/,
  /\/app\/src\//, /consciousness\.db/,
  /\.\.\/\.\./, // path traversal beyond project
];

// Packages that MUST NOT be installed
const BLOCKED_PACKAGES = [
  'child_process', 'cluster', 'shelljs', 'execa',
  'node-pty', 'pty.js', 'sudo-prompt',
];

// Sanitized environment for child processes — NO API keys
const SAFE_ENV = {
  NODE_ENV: 'production',
  HOME: '/tmp',
  PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  LANG: 'C.UTF-8',
};

// =============================================
// RUNNING SERVICES REGISTRY
// =============================================

const runningServices = new Map(); // name -> { proc, port, pid, startedAt, healthUrl, errors }
const usedPorts = new Set();

// =============================================
// CORE: execCommand
// =============================================

export async function execCommand(cmd, { cwd, timeout, env } = {}) {
  // Security: check for blocked patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(cmd)) {
      return { exitCode: 1, stdout: '', stderr: `BLOCKED: Command contains forbidden pattern`, timedOut: false };
    }
  }

  // Security: check first command word is in allowlist
  const firstWord = cmd.trim().split(/\s+/)[0];
  if (!ALLOWED_COMMANDS.includes(firstWord) && !cmd.startsWith('cd ')) {
    return { exitCode: 1, stdout: '', stderr: `BLOCKED: Command "${firstWord}" is not allowed`, timedOut: false };
  }

  // Security: cwd must be under CREATIONS_DIR
  const effectiveCwd = cwd || CREATIONS_DIR;
  const resolvedCwd = path.resolve(effectiveCwd);
  if (!resolvedCwd.startsWith(path.resolve(CREATIONS_DIR))) {
    return { exitCode: 1, stdout: '', stderr: `BLOCKED: Working directory outside creations area`, timedOut: false };
  }

  return new Promise((resolve) => {
    const effectiveTimeout = Math.min(timeout || LIMITS.maxTimeout, LIMITS.maxTimeout);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let resolved = false;

    const proc = spawn('sh', ['-c', cmd], {
      cwd: effectiveCwd,
      timeout: effectiveTimeout,
      env: { ...SAFE_ENV, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.stdout.on('data', (data) => {
      if (stdout.length < LIMITS.maxStdout) {
        stdout += data.toString().slice(0, LIMITS.maxStdout - stdout.length);
      }
    });

    proc.stderr.on('data', (data) => {
      if (stderr.length < LIMITS.maxStderr) {
        stderr += data.toString().slice(0, LIMITS.maxStderr - stderr.length);
      }
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try { proc.kill('SIGKILL'); } catch (_) {}
    }, effectiveTimeout);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (!resolved) {
        resolved = true;
        resolve({ exitCode: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim(), timedOut });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      if (!resolved) {
        resolved = true;
        resolve({ exitCode: 1, stdout: '', stderr: err.message, timedOut: false });
      }
    });
  });
}

// =============================================
// installDeps — npm install with restrictions
// =============================================

export async function installDeps(projectDir) {
  const pkgPath = path.join(projectDir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    return { success: false, error: 'No package.json found' };
  }

  // Validate dependencies
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch (e) {
    return { success: false, error: `Invalid package.json: ${e.message}` };
  }

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const depCount = Object.keys(deps).length;

  if (depCount > LIMITS.maxDependencies) {
    return { success: false, error: `Too many dependencies: ${depCount} (max ${LIMITS.maxDependencies})` };
  }

  // Check blocked packages
  for (const name of Object.keys(deps)) {
    if (BLOCKED_PACKAGES.includes(name)) {
      return { success: false, error: `Blocked package: ${name}` };
    }
  }

  // Run npm install
  const result = await execCommand(
    'npm install --production --ignore-scripts --no-optional --no-audit --no-fund',
    { cwd: projectDir, timeout: 60_000 } // 60s for npm install
  );

  if (result.exitCode !== 0) {
    return { success: false, error: result.stderr || result.stdout, exitCode: result.exitCode };
  }

  // Check node_modules size
  const nmPath = path.join(projectDir, 'node_modules');
  if (fs.existsSync(nmPath)) {
    const size = getDirSize(nmPath);
    if (size > LIMITS.maxNodeModulesSize) {
      // Remove oversized node_modules
      fs.rmSync(nmPath, { recursive: true, force: true });
      return { success: false, error: `node_modules too large: ${(size / 1024 / 1024).toFixed(1)}MB (max ${LIMITS.maxNodeModulesSize / 1024 / 1024}MB)` };
    }
  }

  return { success: true, installedCount: depCount, output: result.stdout.slice(0, 500) };
}

// =============================================
// startService — run a Node.js process
// =============================================

export async function startService(projectName, entryFile = 'src/index.js', healthUrl = '/health') {
  if (runningServices.size >= LIMITS.maxConcurrentServices) {
    return { success: false, error: `Max ${LIMITS.maxConcurrentServices} concurrent services reached` };
  }

  // Stop if already running
  if (runningServices.has(projectName)) {
    await stopService(projectName);
  }

  const projectDir = path.join(CREATIONS_DIR, projectName);
  if (!fs.existsSync(path.join(projectDir, entryFile))) {
    return { success: false, error: `Entry file not found: ${entryFile}` };
  }

  const port = findAvailablePort();
  if (!port) {
    return { success: false, error: 'No available ports' };
  }

  return new Promise((resolve) => {
    const proc = spawn('node', [entryFile], {
      cwd: projectDir,
      env: { ...SAFE_ENV, PORT: String(port), NODE_ENV: 'production' },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
    });

    let stderr = '';
    let startupError = false;

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text.slice(0, 2000);

      // Track errors for the service
      const service = runningServices.get(projectName);
      if (service) {
        if (!service.errors) service.errors = [];
        service.errors.push({ time: Date.now(), text: text.slice(0, 500) });
        if (service.errors.length > 20) service.errors.shift();
      }
    });

    proc.on('error', (err) => {
      startupError = true;
      usedPorts.delete(port);
      resolve({ success: false, error: err.message });
    });

    proc.on('close', (code) => {
      // Process died
      const service = runningServices.get(projectName);
      if (service) {
        usedPorts.delete(service.port);
        runningServices.delete(projectName);
      }
    });

    // Register service
    usedPorts.add(port);
    runningServices.set(projectName, {
      proc, port, pid: proc.pid,
      startedAt: Date.now(),
      healthUrl,
      errors: [],
      entryFile,
    });

    // Wait for startup then check health
    setTimeout(async () => {
      if (startupError) return;

      const healthy = await healthCheck(projectName);
      if (healthy) {
        resolve({ success: true, port, pid: proc.pid });
      } else {
        // Give it one more chance
        setTimeout(async () => {
          const healthy2 = await healthCheck(projectName);
          if (healthy2) {
            resolve({ success: true, port, pid: proc.pid });
          } else {
            await stopService(projectName);
            resolve({ success: false, error: `Service failed health check. Stderr: ${stderr.slice(0, 500)}` });
          }
        }, 3000);
      }
    }, LIMITS.serviceStartupWait);
  });
}

// =============================================
// stopService — kill a running service
// =============================================

export async function stopService(projectName) {
  const service = runningServices.get(projectName);
  if (!service) return { success: false, error: 'Service not found' };

  try {
    service.proc.kill('SIGTERM');
    // Force kill after 5s
    setTimeout(() => {
      try { service.proc.kill('SIGKILL'); } catch (_) {}
    }, 5000);
  } catch (_) {}

  usedPorts.delete(service.port);
  runningServices.delete(projectName);
  return { success: true };
}

// =============================================
// healthCheck — HTTP GET to health endpoint
// =============================================

export async function healthCheck(projectName) {
  const service = runningServices.get(projectName);
  if (!service) return false;

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), LIMITS.healthCheckTimeout);

    const req = http.get(
      `http://127.0.0.1:${service.port}${service.healthUrl || '/health'}`,
      (res) => {
        clearTimeout(timer);
        resolve(res.statusCode >= 200 && res.statusCode < 400);
        res.resume(); // consume response
      }
    );

    req.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

// =============================================
// getRunningServices — return service info
// =============================================

export function getRunningServices() {
  return runningServices;
}

export function getServiceInfo(projectName) {
  const service = runningServices.get(projectName);
  if (!service) return null;
  return {
    port: service.port,
    pid: service.pid,
    startedAt: service.startedAt,
    uptime: Date.now() - service.startedAt,
    errors: service.errors || [],
    healthUrl: service.healthUrl,
  };
}

// =============================================
// smokeTest — start, check health, stop
// =============================================

export async function smokeTest(projectName, entryFile = 'src/index.js', healthUrl = '/health') {
  const startResult = await startService(projectName, entryFile, healthUrl);
  if (!startResult.success) {
    return { success: false, phase: 'start', error: startResult.error };
  }

  // Wait a bit more
  await new Promise(r => setTimeout(r, 2000));

  const healthy = await healthCheck(projectName);
  await stopService(projectName);

  return { success: healthy, phase: healthy ? 'passed' : 'health_check', error: healthy ? null : 'Health check failed' };
}

// =============================================
// HELPERS
// =============================================

function findAvailablePort() {
  for (let p = LIMITS.portRange.min; p <= LIMITS.portRange.max; p++) {
    if (!usedPorts.has(p)) return p;
  }
  return null;
}

function getDirSize(dirPath) {
  let totalSize = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isFile()) {
        totalSize += fs.statSync(fullPath).size;
      } else if (entry.isDirectory()) {
        totalSize += getDirSize(fullPath);
      }
      // Safety: abort if clearly too large
      if (totalSize > LIMITS.maxNodeModulesSize * 1.5) return totalSize;
    }
  } catch (_) {}
  return totalSize;
}

export { LIMITS };
