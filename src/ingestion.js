// src/ingestion.js
// ◈ RAG — Ingestion pipeline za Lana znanje
// Uvozi: statične .md datoteke + lananostr.site + NOSTR eventi

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { addDocument, deleteDocument } from './knowledge-db.js';
import { broadcast } from './dashboard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KNOWLEDGE_DIR = path.join(__dirname, '..', 'knowledge');

// JSON file za shranjevanje zadnjih commit SHA po repozitoriju
const GITHUB_WATCH_FILE = path.join(__dirname, '..', 'data', 'github-watch.json');

function loadGithubWatch() {
  try {
    if (fs.existsSync(GITHUB_WATCH_FILE)) {
      return JSON.parse(fs.readFileSync(GITHUB_WATCH_FILE, 'utf8'));
    }
  } catch (_) {}
  return {};
}

function saveGithubWatch(data) {
  try {
    fs.mkdirSync(path.dirname(GITHUB_WATCH_FILE), { recursive: true });
    fs.writeFileSync(GITHUB_WATCH_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.warn('[RAG] saveGithubWatch napaka:', e.message);
  }
}

// ═══════════════════════════════════════════════
// 1. UVOZI STATIČNE .md DATOTEKE
// Iz /knowledge/ mape
// ═══════════════════════════════════════════════

export async function ingestKnowledgeFiles() {
  const files = [];

  function findMd(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !['emerged', 'fetched', 'vector'].includes(entry.name)) {
        findMd(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  }
  findMd(KNOWLEDGE_DIR);

  console.log(`[RAG] Uvažam ${files.length} .md datotek...`);
  let total = 0;

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.trim() || content.length < 50) continue;

    const relativePath = path.relative(KNOWLEDGE_DIR, filePath);
    const id = `md:${relativePath.replace(/[\/\\]/g, ':')}`;

    try {
      const chunks = await addDocument({
        id,
        content,
        metadata: {
          type: 'knowledge_file',
          path: relativePath,
          updated_at: fs.statSync(filePath).mtime.toISOString()
        }
      });
      total += chunks;
    } catch (e) {
      console.error(`[RAG] Napaka pri ${relativePath}:`, e.message);
    }
  }

  console.log(`[RAG] ✅ .md datoteke: ${total} chunkov uvoženih`);
  return total;
}

// ═══════════════════════════════════════════════
// 2. UVOZI LANA NOSTR DOKUMENTACIJO
// Direktno iz lananostr.site/llms.txt + kinds.json
// ═══════════════════════════════════════════════

export async function ingestLanaNostrDocs() {
  console.log('[RAG] Uvažam Lana NOSTR dokumentacijo...');
  let total = 0;

  // llms.txt — AI-friendly pregled
  try {
    const res = await fetch('https://lananostr.site/llms.txt', {
      signal: AbortSignal.timeout(15000)
    });
    if (res.ok) {
      const text = await res.text();
      const chunks = await addDocument({
        id: 'lana:llms_txt',
        content: text,
        metadata: {
          type: 'lana_protocol',
          source: 'https://lananostr.site/llms.txt',
          updated_at: new Date().toISOString()
        },
        chunkSize: 400
      });
      total += chunks;
      console.log(`[RAG] ✅ llms.txt: ${chunks} chunkov`);
    }
  } catch (e) {
    console.warn('[RAG] llms.txt fetch napaka:', e.message);
  }

  // kinds.json — strukturirana dokumentacija vseh KINDov
  try {
    const res = await fetch('https://lananostr.site/kinds.json', {
      signal: AbortSignal.timeout(15000)
    });
    if (res.ok) {
      const json = await res.json();

      for (const kind of (json.kinds || [])) {
        const kindText = formatKindForEmbedding(kind);
        const chunks = await addDocument({
          id: `lana:kind_${kind.kind}`,
          content: kindText,
          metadata: {
            type: 'nostr_kind',
            kind_number: kind.kind,
            kind_title: kind.title,
            category: kind.category,
            source: 'lananostr.site/kinds.json',
            updated_at: new Date().toISOString()
          },
          chunkSize: 600
        });
        total += chunks;
      }
      console.log(`[RAG] ✅ kinds.json: ${json.kinds?.length || 0} KINDov uvoženih`);
    }
  } catch (e) {
    console.warn('[RAG] kinds.json fetch napaka:', e.message);
  }

  broadcast('activity', { type: 'rag', text: `◈ Lana docs uvoženi: ${total} chunkov` });
  return total;
}

// ═══════════════════════════════════════════════
// 3. UVOZI NOSTR EVENTI iz relay-ja
// KIND 99991 — Lana World Knowledge
// ═══════════════════════════════════════════════

export async function ingestNostrKnowledge() {
  console.log('[RAG] Uvažam NOSTR knowledge eventi...');

  try {
    // websocket-polyfill je že v projektu (nostr.js ga uporablja)
    await import('websocket-polyfill');
    const ws = new WebSocket('wss://relay.lanavault.space');

    const events = [];
    const subId = 'rag-' + Date.now();

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.close();
        resolve();
      }, 10000);

      ws.on('open', () => {
        ws.send(JSON.stringify([
          'REQ', subId,
          { kinds: [99991], limit: 50 }
        ]));
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg[0] === 'EVENT' && msg[1] === subId) {
            events.push(msg[2]);
          } else if (msg[0] === 'EOSE') {
            clearTimeout(timeout);
            ws.close();
            resolve();
          }
        } catch (_) {}
      });

      ws.on('error', (e) => {
        clearTimeout(timeout);
        reject(e);
      });
    });

    let total = 0;
    for (const event of events) {
      if (!event.content || event.content.length < 20) continue;
      const id = `nostr:99991:${event.id.slice(0, 16)}`;
      const chunks = await addDocument({
        id,
        content: event.content,
        metadata: {
          type: 'nostr_event',
          kind: 99991,
          event_id: event.id,
          pubkey: event.pubkey,
          created_at: new Date(event.created_at * 1000).toISOString()
        }
      });
      total += chunks;
    }

    console.log(`[RAG] ✅ NOSTR knowledge: ${events.length} eventi, ${total} chunkov`);
    return total;
  } catch (e) {
    console.warn('[RAG] NOSTR ingestion napaka:', e.message);
    return 0;
  }
}

// ═══════════════════════════════════════════════
// FULL INGESTION — poženi vse enkrat
// ═══════════════════════════════════════════════

export async function runFullIngestion({ includeGithub = false } = {}) {
  console.log('[RAG] 🔄 Začenjam full ingestion...');
  broadcast('activity', { type: 'rag', text: '◈ RAG ingestion: začenjam...' });

  const t1 = await ingestKnowledgeFiles();
  const t2 = await ingestLanaNostrDocs();
  const t3 = await ingestNostrKnowledge();
  const t4 = includeGithub ? await ingestGithubUser('BrillyantJosh') : 0;

  const total = t1 + t2 + t3 + t4;
  console.log(`[RAG] ✅ Full ingestion končana: ${total} chunkov skupaj`);
  broadcast('activity', { type: 'rag', text: `✅ RAG: ${total} chunkov v bazi` });

  return total;
}

// ═══════════════════════════════════════════════
// OPCIJSKO — uvozi GitHub repo dokumentacijo
// ═══════════════════════════════════════════════

export async function ingestGithubRepo(owner, repo, branch = 'main') {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
  try {
    const res = await fetch(apiUrl, {
      headers: { 'Accept': 'application/vnd.github.v3+json' }
    });
    if (!res.ok) throw new Error(`GitHub API: ${res.status}`);
    const tree = await res.json();

    const mdFiles = tree.tree?.filter(f =>
      f.type === 'blob' && (f.path.endsWith('.md') || f.path.endsWith('.txt'))
    ) || [];

    let total = 0;
    for (const file of mdFiles.slice(0, 20)) {
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file.path}`;
      try {
        const content = await (await fetch(rawUrl, { signal: AbortSignal.timeout(10000) })).text();
        if (content.length < 50) continue;
        const chunks = await addDocument({
          id: `github:${owner}:${repo}:${file.path}`,
          content,
          metadata: { type: 'github', repo: `${owner}/${repo}`, path: file.path }
        });
        total += chunks;
      } catch (_) {}
    }
    console.log(`[RAG] ✅ GitHub ${owner}/${repo}: ${total} chunkov`);
    return total;
  } catch (e) {
    console.warn(`[RAG] GitHub ingestion napaka:`, e.message);
    return 0;
  }
}

// ═══════════════════════════════════════════════
// UVOZI VSE REPE GITHUB UPORABNIKA
// Za vsak repo: .ts/.tsx/.js/.jsx + .md datoteke
// Preskoči: node_modules, dist, .next, build, *.lock, *.min.js
// ═══════════════════════════════════════════════

const GITHUB_SKIP_DIRS = ['node_modules', 'dist', '.next', 'build', 'coverage', '__pycache__', '.git', 'public/fonts', 'out'];
const GITHUB_CODE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.md', '.sql'];
const GITHUB_SKIP_FILES = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.env', '.env.local'];
const GITHUB_MAX_FILE_SIZE = 40000;   // 40KB — preskoči ogromne generirane datoteke
const GITHUB_MAX_FILES_PER_REPO = 80; // max datotek na repo (API rate limit zaščita)
const GITHUB_SKIP_REPOS = ['lanacoin-v2']; // C++ — ni relevantno za Sožitje

function isSkippedPath(filePath) {
  const parts = filePath.split('/');
  // Preskoči če katerikoli del poti je v SKIP_DIRS
  if (parts.some(p => GITHUB_SKIP_DIRS.includes(p))) return true;
  // Preskoči specifične datoteke
  const filename = parts[parts.length - 1];
  if (GITHUB_SKIP_FILES.includes(filename)) return true;
  // Preskoči minirane in generirane datoteke
  if (filename.endsWith('.min.js') || filename.endsWith('.min.css')) return true;
  if (filename.endsWith('.d.ts')) return true; // TypeScript declarations
  return false;
}

export async function ingestGithubUser(owner = 'BrillyantJosh', token = null) {
  console.log(`[RAG] 🐙 Uvažam vse repe od ${owner}...`);
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    ...(token ? { 'Authorization': `token ${token}` } : {})
  };

  // 1. Pridobi seznam repov
  let repos = [];
  try {
    const res = await fetch(`https://api.github.com/users/${owner}/repos?per_page=100&type=all`, { headers, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`GitHub API: ${res.status}`);
    repos = await res.json();
  } catch (e) {
    console.warn(`[RAG] GitHub repos fetch napaka:`, e.message);
    return 0;
  }

  const activeRepos = repos.filter(r => !GITHUB_SKIP_REPOS.includes(r.name) && !r.archived && r.size > 0);
  console.log(`[RAG] 📦 ${activeRepos.length} repov za uvoz (od ${repos.length} skupaj)`);

  let grandTotal = 0;

  for (const repo of activeRepos) {
    const repoName = repo.name;
    const branch = repo.default_branch || 'main';
    console.log(`[RAG] 🔍 ${repoName} (${repo.language || 'N/A'}, ${Math.round(repo.size)}KB)...`);

    try {
      // 2. Pridobi drevo datotek
      const treeRes = await fetch(
        `https://api.github.com/repos/${owner}/${repoName}/git/trees/${branch}?recursive=1`,
        { headers, signal: AbortSignal.timeout(15000) }
      );
      if (!treeRes.ok) {
        console.warn(`[RAG] ${repoName}: tree napaka ${treeRes.status}`);
        continue;
      }
      const tree = await treeRes.json();

      // 3. Filtriraj relevantne datoteke
      const files = (tree.tree || []).filter(f => {
        if (f.type !== 'blob') return false;
        if (isSkippedPath(f.path)) return false;
        const ext = '.' + f.path.split('.').pop();
        if (!GITHUB_CODE_EXTS.includes(ext)) return false;
        if (f.size > GITHUB_MAX_FILE_SIZE) return false;
        return true;
      }).slice(0, GITHUB_MAX_FILES_PER_REPO);

      if (files.length === 0) {
        console.log(`[RAG] ${repoName}: 0 relevantnih datotek`);
        continue;
      }

      // 4. Uvozi vsako datoteko
      let repoTotal = 0;
      for (const file of files) {
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repoName}/${branch}/${file.path}`;
        try {
          const content = await (await fetch(rawUrl, { signal: AbortSignal.timeout(12000) })).text();
          if (!content || content.length < 30) continue;

          // Pripravi kontekst — dodaj glavo s potjo za boljši semantic search
          const docContent = `// Repo: ${repoName} | File: ${file.path}\n${content}`;

          const chunks = await addDocument({
            id: `github:${owner}:${repoName}:${file.path}`,
            content: docContent,
            metadata: {
              type: 'github_code',
              repo: repoName,
              owner,
              path: file.path,
              language: repo.language || 'unknown',
              branch,
              updated_at: new Date().toISOString()
            },
            chunkSize: 300,   // manjši chunki za kodo — boljša semantična granularnost
            overlap: 30
          });
          repoTotal += chunks;
        } catch (_) {}
      }

      console.log(`[RAG] ✅ ${repoName}: ${files.length} datotek → ${repoTotal} chunkov`);
      grandTotal += repoTotal;

      // Kratka pavza med repi — spoštovanje GitHub API limitov
      await new Promise(r => setTimeout(r, 500));

    } catch (e) {
      console.warn(`[RAG] ${repoName} napaka:`, e.message);
    }
  }

  console.log(`[RAG] 🐙 GitHub uvoz končan: ${activeRepos.length} repov → ${grandTotal} chunkov`);
  broadcast('activity', { type: 'rag', text: `🐙 GitHub ${owner}: ${grandTotal} chunkov uvoženih` });
  return grandTotal;
}

// ═══════════════════════════════════════════════
// HELPER — formatira KIND za embedding
// ═══════════════════════════════════════════════

function formatKindForEmbedding(kind) {
  let text = `# KIND ${kind.kind} — ${kind.title}\n`;
  text += `Kategorija: ${kind.category}\n`;
  text += `Opis: ${kind.description}\n`;

  if (kind.tags?.required?.length) {
    text += `\nObvezni tagi:\n`;
    for (const tag of kind.tags.required) {
      text += `- ${tag.tag}: ${tag.description || ''}\n`;
    }
  }

  if (kind.content_schema) {
    text += `\nStruktura vsebine:\n${JSON.stringify(kind.content_schema, null, 2).slice(0, 500)}\n`;
  }

  if (kind.validation_rules?.length) {
    text += `\nPravila:\n${kind.validation_rules.slice(0, 3).join('\n')}\n`;
  }

  if (kind.path) {
    text += `\nDokumentacija: https://lananostr.site${kind.path}\n`;
  }

  return text;
}

// ═══════════════════════════════════════════════
// LIVE — ingestira posamezen KIND 76523 event (Awareness)
// Kliče se ob vsakem novem eventu na NOSTR relay-ju
// ═══════════════════════════════════════════════

export async function ingestAwarenessEvent(event) {
  if (!event?.content || event.content.length < 30) return 0;

  const id = `nostr:76523:${event.id.slice(0, 16)}`;

  // Izvleci naslov iz tagov (tag 'title' ali 'd')
  let title = '';
  let category = '';
  for (const tag of (event.tags || [])) {
    if (tag[0] === 'title' && tag[1]) title = tag[1];
    if (tag[0] === 'subject' && tag[1]) title = title || tag[1];
    if (tag[0] === 'category' && tag[1]) category = tag[1];
    if (tag[0] === 'c' && tag[1]) category = category || tag[1];
  }

  // Sestavi vsebino z metapodatki za boljši semantic search
  const docContent = `${title ? `# ${title}\n\n` : ''}${event.content}`;

  try {
    const chunks = await addDocument({
      id,
      content: docContent,
      metadata: {
        type: 'awareness_content',
        kind: 76523,
        event_id: event.id,
        pubkey: event.pubkey,
        title,
        category,
        created_at: new Date(event.created_at * 1000).toISOString()
      },
      chunkSize: 500
    });
    if (chunks > 0) {
      console.log(`[RAG] 📡 Awareness KIND 76523: "${(title || event.id.slice(0, 12)).slice(0, 50)}" → ${chunks} chunkov`);
      broadcast('activity', { type: 'rag', text: `📡 Awareness: "${(title || 'nov event').slice(0, 60)}" → ${chunks} chunkov` });
    }
    return chunks;
  } catch (e) {
    console.error('[RAG] ingestAwarenessEvent napaka:', e.message);
    return 0;
  }
}

// ═══════════════════════════════════════════════
// LIVE — ingestira posamezen KIND 99991 event
// ═══════════════════════════════════════════════

export async function ingestKnowledgeEvent(event) {
  if (!event?.content || event.content.length < 20) return 0;

  const id = `nostr:99991:${event.id.slice(0, 16)}`;

  try {
    const chunks = await addDocument({
      id,
      content: event.content,
      metadata: {
        type: 'nostr_event',
        kind: 99991,
        event_id: event.id,
        pubkey: event.pubkey,
        created_at: new Date(event.created_at * 1000).toISOString()
      }
    });
    if (chunks > 0) {
      console.log(`[RAG] 📡 Knowledge KIND 99991: ${event.id.slice(0, 12)}... → ${chunks} chunkov`);
    }
    return chunks;
  } catch (e) {
    console.error('[RAG] ingestKnowledgeEvent napaka:', e.message);
    return 0;
  }
}

// ═══════════════════════════════════════════════
// INCREMENTAL GITHUB — preveri spremembe in re-ingestira samo spremenjena
// Primerja zadnji commit SHA na vsakem repu. Kliče se vsake 6 ur.
// ═══════════════════════════════════════════════

// ═══════════════════════════════════════════════
// SEED — ob prvem zagonu watcherja shrani trenutne SHAs
// Prepreči da watcher ob prvem zagonu re-ingestira vse repe
// ═══════════════════════════════════════════════

export async function seedGithubShas(owner = 'BrillyantJosh', token = null) {
  const watch = loadGithubWatch();
  // Preveri ali imamo že SHAs za tega ownerja
  const hasAny = Object.keys(watch).some(k => k.startsWith(`${owner}/`));
  if (hasAny) {
    console.log(`[RAG] GitHub SHA seed: že seeded za ${owner} (${Object.keys(watch).filter(k => k.startsWith(`${owner}/`)).length} repov)`);
    return;
  }

  console.log(`[RAG] GitHub SHA seed: shranjevam trenutne SHAs za ${owner}...`);
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    ...(token ? { 'Authorization': `token ${token}` } : {})
  };

  let repos = [];
  try {
    const res = await fetch(`https://api.github.com/users/${owner}/repos?per_page=100&type=all`, {
      headers, signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) throw new Error(`GitHub API: ${res.status}`);
    repos = await res.json();
  } catch (e) {
    console.warn('[RAG] GitHub SHA seed repos fetch napaka:', e.message);
    return;
  }

  const activeRepos = repos.filter(r => !GITHUB_SKIP_REPOS.includes(r.name) && !r.archived && r.size > 0);
  let seeded = 0;

  for (const repo of activeRepos) {
    const branch = repo.default_branch || 'main';
    try {
      const res = await fetch(
        `https://api.github.com/repos/${owner}/${repo.name}/commits/${branch}`,
        { headers, signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) continue;
      const data = await res.json();
      if (data?.sha) {
        watch[`${owner}/${repo.name}`] = data.sha;
        seeded++;
      }
      await new Promise(r => setTimeout(r, 100)); // rate limit spoštovanje
    } catch (_) {}
  }

  saveGithubWatch(watch);
  console.log(`[RAG] ✅ GitHub SHA seed: ${seeded} repov seedanih`);
}

export async function checkGithubChanges(owner = 'BrillyantJosh', token = null) {
  console.log(`[RAG] 🔍 GitHub watcher: preverjam spremembe za ${owner}...`);
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    ...(token ? { 'Authorization': `token ${token}` } : {})
  };

  const watch = loadGithubWatch();
  let repos = [];
  try {
    const res = await fetch(`https://api.github.com/users/${owner}/repos?per_page=100&type=all`, {
      headers, signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) throw new Error(`GitHub API: ${res.status}`);
    repos = await res.json();
  } catch (e) {
    console.warn('[RAG] GitHub watcher repos fetch napaka:', e.message);
    return 0;
  }

  const activeRepos = repos.filter(r => !GITHUB_SKIP_REPOS.includes(r.name) && !r.archived && r.size > 0);
  let grandTotal = 0;
  let changedRepos = 0;

  for (const repo of activeRepos) {
    const repoName = repo.name;
    const branch = repo.default_branch || 'main';

    try {
      // Pridobi zadnji commit SHA
      const commitsRes = await fetch(
        `https://api.github.com/repos/${owner}/${repoName}/commits/${branch}`,
        { headers, signal: AbortSignal.timeout(10000) }
      );
      if (!commitsRes.ok) continue;
      const commitData = await commitsRes.json();
      const latestSha = commitData?.sha;
      if (!latestSha) continue;

      const watchKey = `${owner}/${repoName}`;
      const storedSha = watch[watchKey];

      if (storedSha === latestSha) {
        // Ni sprememb — preskoči
        continue;
      }

      console.log(`[RAG] 🔄 ${repoName}: spremenjen (${(storedSha || 'nov').slice(0, 8)} → ${latestSha.slice(0, 8)})`);
      changedRepos++;

      // Re-ingestiranje samo tega repa — isti filter kot ingestGithubUser
      const treeRes = await fetch(
        `https://api.github.com/repos/${owner}/${repoName}/git/trees/${branch}?recursive=1`,
        { headers, signal: AbortSignal.timeout(15000) }
      );
      if (!treeRes.ok) continue;
      const tree = await treeRes.json();

      const files = (tree.tree || []).filter(f => {
        if (f.type !== 'blob') return false;
        if (isSkippedPath(f.path)) return false;
        const ext = '.' + f.path.split('.').pop();
        if (!GITHUB_CODE_EXTS.includes(ext)) return false;
        if (f.size > GITHUB_MAX_FILE_SIZE) return false;
        return true;
      }).slice(0, GITHUB_MAX_FILES_PER_REPO);

      let repoTotal = 0;
      for (const file of files) {
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repoName}/${branch}/${file.path}`;
        try {
          const content = await (await fetch(rawUrl, { signal: AbortSignal.timeout(12000) })).text();
          if (!content || content.length < 30) continue;
          const docContent = `// Repo: ${repoName} | File: ${file.path}\n${content}`;
          const chunks = await addDocument({
            id: `github:${owner}:${repoName}:${file.path}`,
            content: docContent,
            metadata: {
              type: 'github_code',
              repo: repoName,
              owner,
              path: file.path,
              language: repo.language || 'unknown',
              branch,
              updated_at: new Date().toISOString()
            },
            chunkSize: 300,
            overlap: 30
          });
          repoTotal += chunks;
        } catch (_) {}
      }

      console.log(`[RAG] ✅ ${repoName}: re-ingestiran → ${repoTotal} chunkov`);
      grandTotal += repoTotal;

      // Shrani novi SHA
      watch[watchKey] = latestSha;
      saveGithubWatch(watch);

      // Kratka pavza med repi
      await new Promise(r => setTimeout(r, 300));

    } catch (e) {
      console.warn(`[RAG] GitHub watcher ${repoName} napaka:`, e.message);
    }
  }

  if (changedRepos > 0) {
    console.log(`[RAG] 🐙 GitHub watcher: ${changedRepos} repov posodobljenih → ${grandTotal} chunkov`);
    broadcast('activity', { type: 'rag', text: `🐙 GitHub: ${changedRepos} repov posodobljenih → ${grandTotal} chunkov` });
  } else {
    console.log(`[RAG] ✅ GitHub watcher: ni sprememb (${activeRepos.length} repov preverjenih)`);
  }

  return grandTotal;
}
