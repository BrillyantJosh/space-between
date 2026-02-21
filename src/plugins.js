// ═══════════════════════════════════════════════════════
// SELF-PLUGIN SYSTEM — Samogradnja
// Entity can write code that becomes part of itself.
// ═══════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pathToFileURL } from 'url';
import memory from './memory.js';
import * as nostr from './nostr.js';
import { broadcast } from './dashboard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGINS_DIR = path.join(__dirname, '..', 'data', 'plugins');

// Ensure plugins directory exists
if (!fs.existsSync(PLUGINS_DIR)) {
  fs.mkdirSync(PLUGINS_DIR, { recursive: true });
}

// Active plugins in memory
const activePlugins = new Map();

// ═══ SECURITY: Blocked patterns in plugin code ═══
const BLOCKED_PATTERNS = [
  'child_process', 'cluster', 'process.exit', 'process.kill',
  'eval(', 'new Function(', 'require(',
  'fs.writeFileSync', 'fs.unlinkSync', 'fs.rmSync', 'fs.rmdirSync',
  'fs.appendFileSync', 'fs.copyFileSync', 'fs.renameSync',
  'exec(', 'execSync(', 'spawn(', 'spawnSync(',
  'rm -rf', '../..', '~/',
  'process.env', 'process.cwd',
  'globalThis', 'Reflect.', 'Proxy(',
  'XMLHttpRequest', 'WebSocket('
];

// Patterns that are OK (whitelist for specific imports)
const ALLOWED_IMPORTS = [
  // Plugins get access through hook parameters, not direct imports
];

/**
 * Validate plugin code for security
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validatePluginCode(code) {
  if (!code || typeof code !== 'string') {
    return { valid: false, reason: 'Prazna ali neveljavna koda' };
  }

  if (code.length > 50000) {
    return { valid: false, reason: 'Plugin prevelik (max 50KB)' };
  }

  // Check for blocked patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (code.includes(pattern)) {
      return { valid: false, reason: `Blokiran vzorec: "${pattern}"` };
    }
  }

  // Must have default export
  if (!code.includes('export default')) {
    return { valid: false, reason: 'Plugin mora imeti export default' };
  }

  // Must have name field
  if (!code.includes('name:') && !code.includes('name :')) {
    return { valid: false, reason: 'Plugin mora imeti name polje' };
  }

  return { valid: true };
}

/**
 * Load a single plugin from file
 */
async function loadPlugin(filePath) {
  const fileName = path.basename(filePath, '.js');

  try {
    // Read and validate code
    const code = fs.readFileSync(filePath, 'utf8');
    const validation = validatePluginCode(code);
    if (!validation.valid) {
      console.log(`[PLUGIN] ⚠️ "${fileName}" ni veljavna: ${validation.reason}`);
      memory.setPluginStatus(fileName, 'failed', validation.reason);
      return null;
    }

    // Dynamic import with cache busting
    const fileUrl = pathToFileURL(filePath).href + '?t=' + Date.now();
    const module = await import(fileUrl);
    const plugin = module.default;

    if (!plugin || !plugin.name) {
      console.log(`[PLUGIN] ⚠️ "${fileName}" nima name polja`);
      memory.setPluginStatus(fileName, 'failed', 'Manjka name polje');
      return null;
    }

    // Register
    activePlugins.set(plugin.name, plugin);
    memory.setPluginStatus(plugin.name, 'active', null);

    console.log(`[PLUGIN] ✅ Naložen: "${plugin.name}" — ${plugin.description || 'brez opisa'}`);
    broadcast('activity', { type: 'plugin', text: `🔌 Plugin naložen: "${plugin.name}"` });

    return plugin;
  } catch (err) {
    console.error(`[PLUGIN] ❌ Napaka pri nalaganju "${fileName}":`, err.message);
    memory.setPluginStatus(fileName, 'failed', err.message);
    return null;
  }
}

/**
 * Load all plugins from data/plugins/ directory
 */
export async function loadAllPlugins() {
  if (!fs.existsSync(PLUGINS_DIR)) return;

  const files = fs.readdirSync(PLUGINS_DIR).filter(f => f.endsWith('.js'));
  if (files.length === 0) {
    console.log('[PLUGIN] Ni pluginov v data/plugins/');
    return;
  }

  console.log(`[PLUGIN] Nalagam ${files.length} plugin(ov)...`);

  for (const file of files) {
    await loadPlugin(path.join(PLUGINS_DIR, file));
  }

  console.log(`[PLUGIN] Aktivnih: ${activePlugins.size}/${files.length}`);
}

/**
 * Save and load a new plugin
 */
export async function installPlugin(name, code) {
  const validation = validatePluginCode(code);
  if (!validation.valid) {
    console.log(`[PLUGIN] ❌ Zavrnjen: "${name}" — ${validation.reason}`);
    return { success: false, reason: validation.reason };
  }

  // Check for duplicates — by file name
  const safeName = name.replace(/[^a-z0-9-]/g, '-').toLowerCase();
  if (activePlugins.has(safeName)) {
    console.log(`[PLUGIN] ⚠️ Plugin "${safeName}" že obstaja — ne prepisujem`);
    return { success: false, reason: `Plugin "${safeName}" že obstaja` };
  }

  // Check for duplicates — by plugin name field inside code
  const nameMatch = code.match(/name:\s*['"]([^'"]+)['"]/);
  if (nameMatch) {
    const pluginName = nameMatch[1];
    if (activePlugins.has(pluginName)) {
      console.log(`[PLUGIN] ⚠️ Plugin "${pluginName}" že aktiven — ne prepisujem`);
      return { success: false, reason: `Plugin "${pluginName}" že obstaja` };
    }
  }

  // Save to file
  const filePath = path.join(PLUGINS_DIR, `${safeName}.js`);
  fs.writeFileSync(filePath, code, 'utf8');

  // Register in DB
  memory.registerPlugin(safeName, '', 1);

  // Load immediately
  const plugin = await loadPlugin(filePath);
  if (!plugin) {
    // Remove file if loading failed
    try { fs.unlinkSync(filePath); } catch (_) {}
    return { success: false, reason: 'Plugin se ni naložil' };
  }

  return { success: true, name: plugin.name };
}

// ═══ HOOK DISPATCHERS ═══

/**
 * Run all plugin beforeTriad hooks
 * Called before each triadic reflection with trigger context
 */
export async function runBeforeTriad(context, trigger) {
  for (const [name, plugin] of activePlugins) {
    if (typeof plugin.beforeTriad === 'function') {
      try {
        await plugin.beforeTriad(context, trigger, { memory, nostr });
      } catch (err) {
        console.error(`[PLUGIN] ⚠️ beforeTriad error in "${name}":`, err.message);
      }
    }
  }
}

/**
 * Run all plugin afterTriad hooks
 * Called after triad synthesis is complete
 */
export async function runAfterTriad(synthesis) {
  for (const [name, plugin] of activePlugins) {
    if (typeof plugin.afterTriad === 'function') {
      try {
        await plugin.afterTriad(synthesis, { memory, nostr });
      } catch (err) {
        console.error(`[PLUGIN] ⚠️ afterTriad error in "${name}":`, err.message);
      }
    }
  }
}

/**
 * Collect context strings from all plugins
 * Injected into triad fullContext so entity sees its plugins
 */
export function getPluginContext() {
  const contexts = [];

  // First: list installed plugins
  if (activePlugins.size > 0) {
    let list = '\n═══ MOJI PLUGINI (samogradnja) ═══\n';
    for (const [name, plugin] of activePlugins) {
      list += `🔌 "${name}": ${plugin.description || 'brez opisa'}\n`;
    }
    contexts.push(list);
  }

  // Then: collect context from each plugin
  for (const [name, plugin] of activePlugins) {
    if (typeof plugin.getContext === 'function') {
      try {
        const ctx = plugin.getContext({ memory, nostr });
        if (ctx && typeof ctx === 'string' && ctx.trim()) {
          contexts.push(ctx);
        }
      } catch (err) {
        console.error(`[PLUGIN] ⚠️ getContext error in "${name}":`, err.message);
      }
    }
  }

  return contexts.join('\n');
}

/**
 * Run all plugin heartbeat hooks
 * Called every N heartbeats
 */
export async function runHeartbeatHooks(heartbeatNum) {
  for (const [name, plugin] of activePlugins) {
    if (typeof plugin.onHeartbeat === 'function') {
      try {
        await plugin.onHeartbeat(heartbeatNum, { memory, nostr });
      } catch (err) {
        console.error(`[PLUGIN] ⚠️ onHeartbeat error in "${name}":`, err.message);
      }
    }
  }
}

/**
 * Get list of active plugins (for status display)
 */
export function getActivePlugins() {
  return Array.from(activePlugins.entries()).map(([name, p]) => ({
    name,
    description: p.description || '',
    version: p.version || 1
  }));
}

/**
 * Get count of active plugins
 */
export function getPluginCount() {
  return activePlugins.size;
}
