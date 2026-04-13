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

export async function runFullIngestion() {
  console.log('[RAG] 🔄 Začenjam full ingestion...');
  broadcast('activity', { type: 'rag', text: '◈ RAG ingestion: začenjam...' });

  const t1 = await ingestKnowledgeFiles();
  const t2 = await ingestLanaNostrDocs();
  const t3 = await ingestNostrKnowledge();

  const total = t1 + t2 + t3;
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
