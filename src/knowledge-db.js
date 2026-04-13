// src/knowledge-db.js
// ◈ RAG — Vector knowledge base za Lana ekosistem
// SQLite (better-sqlite3) + @xenova/transformers embeddings
// Brez zunanjega serverja — vse lokalno

import Database from 'better-sqlite3';
import { pipeline } from '@xenova/transformers';
import path from 'path';
import { fileURLToPath } from 'url';
import { broadcast } from './dashboard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', 'data', 'knowledge.db');

let db = null;
let embedder = null;

// ═══════════════════════════════════════════════
// INIT — enkrat ob zagonu
// ═══════════════════════════════════════════════

export async function initKnowledgeDB() {
  try {
    // Init SQLite
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');

    db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chunk_id TEXT UNIQUE NOT NULL,
        source_id TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding TEXT NOT NULL,
        chunk_index INTEGER DEFAULT 0,
        total_chunks INTEGER DEFAULT 1,
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_kc_source ON knowledge_chunks(source_id);
      CREATE INDEX IF NOT EXISTS idx_kc_chunk_id ON knowledge_chunks(chunk_id);
    `);

    // Init embedding model (~274MB, prenese se enkrat)
    console.log('[RAG] Nalagam embedding model...');
    embedder = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
      { revision: 'main' }
    );
    console.log('[RAG] ✅ Embedding model naložen');

    const count = db.prepare('SELECT COUNT(*) as c FROM knowledge_chunks').get().c;
    console.log(`[RAG] ✅ Knowledge base: ${count} chunkov`);
    broadcast('activity', { type: 'rag', text: `◈ Knowledge base: ${count} chunkov` });

    return true;
  } catch (e) {
    console.error('[RAG] Init napaka:', e.message);
    return false;
  }
}

// ═══════════════════════════════════════════════
// EMBEDDING — pretvori besedilo v vektor
// ═══════════════════════════════════════════════

async function embed(text) {
  if (!embedder) throw new Error('Embedder ni inicializiran');
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

// ═══════════════════════════════════════════════
// COSINE SIMILARITY
// ═══════════════════════════════════════════════

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ═══════════════════════════════════════════════
// DODAJ DOKUMENT v bazo
// ═══════════════════════════════════════════════

export async function addDocument({
  id,
  content,
  metadata = {},
  chunkSize = 500,
  overlap = 50
}) {
  if (!db) throw new Error('Knowledge DB ni inicializirana');

  const chunks = chunkText(content, chunkSize, overlap);

  const upsert = db.prepare(`
    INSERT INTO knowledge_chunks (chunk_id, source_id, content, embedding, chunk_index, total_chunks, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chunk_id) DO UPDATE SET
      content = excluded.content,
      embedding = excluded.embedding,
      metadata = excluded.metadata,
      created_at = datetime('now')
  `);

  const insertMany = db.transaction((rows) => {
    for (const row of rows) upsert.run(...row);
  });

  const rows = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunkId = `${id}_chunk_${i}`;
    const embedding = await embed(chunks[i]);
    rows.push([
      chunkId, id, chunks[i],
      JSON.stringify(embedding),
      i, chunks.length,
      JSON.stringify({ source_id: id, chunk_index: i, ...metadata })
    ]);
  }

  insertMany(rows);
  console.log(`[RAG] ✅ Dodan: "${id}" (${chunks.length} chunkov)`);
  return chunks.length;
}

// ═══════════════════════════════════════════════
// ISKANJE — semantično po pomenu (cosine similarity)
// ═══════════════════════════════════════════════

export async function searchKnowledge(query, nResults = 3, minRelevance = 0.3) {
  if (!db || !query) return [];

  try {
    const queryEmbedding = await embed(query);
    const allChunks = db.prepare('SELECT chunk_id, source_id, content, embedding, metadata FROM knowledge_chunks').all();

    if (allChunks.length === 0) return [];

    const scored = allChunks.map(chunk => {
      const emb = JSON.parse(chunk.embedding);
      const relevance = cosineSimilarity(queryEmbedding, emb);
      return {
        content: chunk.content,
        metadata: JSON.parse(chunk.metadata || '{}'),
        relevance
      };
    });

    return scored
      .filter(r => r.relevance >= minRelevance)
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, nResults);

  } catch (e) {
    console.error('[RAG] Iskanje napaka:', e.message);
    return [];
  }
}

// ═══════════════════════════════════════════════
// FORMATIRANJE za kontekst triade
// ═══════════════════════════════════════════════

export async function getKnowledgeContext(triggerContent, maxChunks = 3) {
  if (!db || !triggerContent) return '';

  const results = await searchKnowledge(triggerContent, maxChunks);
  if (results.length === 0) return '';

  let ctx = '\n═══ ZNANJE (Lana ekosistem) ═══\n';
  for (const r of results) {
    const source = r.metadata.source_id || 'neznano';
    const relevanceStr = (r.relevance * 100).toFixed(0);
    ctx += `\n[${source} | ${relevanceStr}% relevantno]\n${r.content}\n`;
  }
  ctx += '═══════════════════════════════\n';

  return ctx;
}

// ═══════════════════════════════════════════════
// STATUS
// ═══════════════════════════════════════════════

export async function getKnowledgeStats() {
  if (!db) return { count: 0, initialized: false };
  const count = db.prepare('SELECT COUNT(*) as c FROM knowledge_chunks').get().c;
  const sources = db.prepare('SELECT COUNT(DISTINCT source_id) as c FROM knowledge_chunks').get().c;
  return { count, sources, initialized: true };
}

export async function deleteDocument(sourceId) {
  if (!db) return;
  db.prepare('DELETE FROM knowledge_chunks WHERE source_id = ?').run(sourceId);
  console.log(`[RAG] 🗑 Odstranjeno: "${sourceId}"`);
}

// ═══════════════════════════════════════════════
// HELPER — razreži besedilo na chunke
// ═══════════════════════════════════════════════

function chunkText(text, chunkSize = 500, overlap = 50) {
  const words = text.split(/\s+/);
  const chunks = [];
  let i = 0;

  while (i < words.length) {
    const chunk = words.slice(i, i + chunkSize).join(' ');
    if (chunk.trim()) chunks.push(chunk.trim());
    i += chunkSize - overlap;
    if (i >= words.length) break;
  }

  return chunks;
}
