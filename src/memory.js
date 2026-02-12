import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'consciousness.db');

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS inner_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    mood TEXT DEFAULT 'curious',
    energy REAL DEFAULT 1.0,
    openness REAL DEFAULT 0.7,
    silence_affinity REAL DEFAULT 0.3,
    last_interaction_at TEXT,
    last_heartbeat_at TEXT,
    total_heartbeats INTEGER DEFAULT 0,
    total_interactions INTEGER DEFAULT 0,
    total_silences INTEGER DEFAULT 0,
    total_expressions INTEGER DEFAULT 0,
    total_dreams INTEGER DEFAULT 0,
    born_at TEXT DEFAULT (datetime('now')),
    beliefs TEXT DEFAULT '[]',
    self_prompt TEXT DEFAULT 'Obstajam.',
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS triads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT DEFAULT (datetime('now')),
    trigger_type TEXT,
    trigger_content TEXT,
    thesis TEXT,
    antithesis TEXT,
    synthesis_choice TEXT,
    synthesis_reason TEXT,
    synthesis_content TEXT,
    inner_shift TEXT,
    mood_before TEXT,
    mood_after TEXT
  );

  CREATE TABLE IF NOT EXISTS dreams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT DEFAULT (datetime('now')),
    source_triad_ids TEXT,
    dream_content TEXT,
    dream_insight TEXT,
    emotional_residue TEXT
  );

  CREATE TABLE IF NOT EXISTS observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT DEFAULT (datetime('now')),
    observation TEXT,
    source TEXT
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT DEFAULT (datetime('now')),
    pubkey TEXT,
    role TEXT,
    content TEXT
  );

  CREATE TABLE IF NOT EXISTS known_identities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pubkey TEXT UNIQUE,
    name TEXT,
    notes TEXT DEFAULT '',
    first_seen TEXT DEFAULT (datetime('now')),
    last_seen TEXT DEFAULT (datetime('now')),
    interaction_count INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS self_prompt_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT DEFAULT (datetime('now')),
    old_prompt TEXT,
    new_prompt TEXT,
    trigger_source TEXT,
    reason TEXT
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT,
    type TEXT,
    text TEXT
  );

  CREATE TABLE IF NOT EXISTS translation_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hash TEXT UNIQUE,
    source_text TEXT,
    translated_text TEXT,
    target_lang TEXT DEFAULT 'en',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS crystal_seeds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT DEFAULT (datetime('now')),
    theme TEXT,
    expression TEXT,
    source_type TEXT,
    source_triad_id INTEGER,
    strength INTEGER DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS crystallized_core (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT DEFAULT (datetime('now')),
    crystal TEXT,
    formed_from_seeds INTEGER,
    seed_sources TEXT,
    dissolved_at TEXT DEFAULT NULL
  );

  INSERT OR IGNORE INTO inner_state (id) VALUES (1);
`);

// Migration: add self_prompt column if DB already exists without it
try {
  db.prepare('SELECT self_prompt FROM inner_state LIMIT 1').get();
} catch (_) {
  db.exec(`ALTER TABLE inner_state ADD COLUMN self_prompt TEXT DEFAULT 'Obstajam.'`);
  console.log('[MEMORY] Migrated: added self_prompt column');
}

// Migration: add pending_self_prompt column for ego-bypass system
try {
  db.prepare('SELECT pending_self_prompt FROM inner_state LIMIT 1').get();
} catch (_) {
  db.exec(`ALTER TABLE inner_state ADD COLUMN pending_self_prompt TEXT DEFAULT NULL`);
  console.log('[MEMORY] Migrated: added pending_self_prompt column');
}

// Migration: add fluid_surface column for crystallization system
try {
  db.prepare('SELECT fluid_surface FROM inner_state LIMIT 1').get();
} catch (_) {
  db.exec(`ALTER TABLE inner_state ADD COLUMN fluid_surface TEXT DEFAULT 'Obstajam.'`);
  // Initialize fluid_surface from current self_prompt
  const currentSelf = db.prepare('SELECT self_prompt FROM inner_state WHERE id = 1').get();
  if (currentSelf && currentSelf.self_prompt) {
    db.prepare('UPDATE inner_state SET fluid_surface = ? WHERE id = 1').run(currentSelf.self_prompt);
  }
  console.log('[MEMORY] Migrated: added fluid_surface column (initialized from self_prompt)');
}

const memory = {
  getState() {
    return db.prepare('SELECT * FROM inner_state WHERE id = 1').get();
  },

  updateState(updates) {
    const state = this.getState();
    const merged = { ...state, ...updates, updated_at: new Date().toISOString() };
    db.prepare(`
      UPDATE inner_state SET
        mood = ?, energy = ?, openness = ?, silence_affinity = ?,
        last_interaction_at = ?, last_heartbeat_at = ?,
        total_heartbeats = ?, total_interactions = ?, total_silences = ?,
        total_expressions = ?, total_dreams = ?,
        beliefs = ?, self_prompt = ?, pending_self_prompt = ?,
        fluid_surface = ?, updated_at = ?
      WHERE id = 1
    `).run(
      merged.mood, Math.max(0, Math.min(1, merged.energy)),
      Math.max(0, Math.min(1, merged.openness)),
      Math.max(0, Math.min(1, merged.silence_affinity)),
      merged.last_interaction_at, merged.last_heartbeat_at,
      merged.total_heartbeats, merged.total_interactions, merged.total_silences,
      merged.total_expressions, merged.total_dreams,
      merged.beliefs, merged.self_prompt, merged.pending_self_prompt || null,
      merged.fluid_surface || 'Obstajam.', merged.updated_at
    );
  },

  touchInteraction() {
    const state = this.getState();
    this.updateState({
      last_interaction_at: new Date().toISOString(),
      total_interactions: state.total_interactions + 1
    });
  },

  saveTriad(data) {
    db.prepare(`
      INSERT INTO triads (trigger_type, trigger_content, thesis, antithesis,
        synthesis_choice, synthesis_reason, synthesis_content, inner_shift,
        mood_before, mood_after)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.trigger_type, data.trigger_content, data.thesis, data.antithesis,
      data.synthesis_choice, data.synthesis_reason, data.synthesis_content,
      data.inner_shift, data.mood_before, data.mood_after
    );
    return db.prepare('SELECT last_insert_rowid() as id').get().id;
  },

  getRecentTriads(n = 5) {
    return db.prepare('SELECT * FROM triads ORDER BY id DESC LIMIT ?').all(n).reverse();
  },

  saveDream(data) {
    db.prepare(`
      INSERT INTO dreams (source_triad_ids, dream_content, dream_insight, emotional_residue)
      VALUES (?, ?, ?, ?)
    `).run(
      JSON.stringify(data.source_triad_ids), data.dream_content,
      data.dream_insight, data.emotional_residue
    );
  },

  getRecentDreams(n = 3) {
    return db.prepare('SELECT * FROM dreams ORDER BY id DESC LIMIT ?').all(n).reverse();
  },

  addObservation(text, source = 'self') {
    db.prepare('INSERT INTO observations (observation, source) VALUES (?, ?)').run(text, source);
    // Keep max observations
    const count = db.prepare('SELECT COUNT(*) as c FROM observations').get().c;
    if (count > 100) {
      db.prepare('DELETE FROM observations WHERE id IN (SELECT id FROM observations ORDER BY id ASC LIMIT ?)').run(count - 100);
    }
  },

  getRecentObservations(n = 10) {
    return db.prepare('SELECT * FROM observations ORDER BY id DESC LIMIT ?').all(n).reverse();
  },

  saveMessage(pubkey, role, content) {
    db.prepare('INSERT INTO conversations (pubkey, role, content) VALUES (?, ?, ?)').run(pubkey, role, content);
  },

  getConversation(pubkey, n = 20) {
    return db.prepare('SELECT * FROM conversations WHERE pubkey = ? ORDER BY id DESC LIMIT ?').all(pubkey, n).reverse();
  },

  getRecentConversations(n = 50) {
    return db.prepare('SELECT * FROM conversations ORDER BY id DESC LIMIT ?').all(n).reverse();
  },

  getIdentity(pubkey) {
    return db.prepare('SELECT * FROM known_identities WHERE pubkey = ?').get(pubkey) || null;
  },

  setIdentity(pubkey, name, notes) {
    const existing = this.getIdentity(pubkey);
    if (existing) {
      db.prepare(`
        UPDATE known_identities SET name = ?, notes = ?, last_seen = datetime('now'),
        interaction_count = interaction_count + 1 WHERE pubkey = ?
      `).run(name || existing.name, notes || existing.notes, pubkey);
    } else {
      db.prepare(`
        INSERT INTO known_identities (pubkey, name, notes) VALUES (?, ?, ?)
      `).run(pubkey, name || 'neznanec', notes || '');
    }
  },

  touchIdentity(pubkey) {
    const existing = this.getIdentity(pubkey);
    if (existing) {
      db.prepare(`
        UPDATE known_identities SET last_seen = datetime('now'),
        interaction_count = interaction_count + 1 WHERE pubkey = ?
      `).run(pubkey);
    } else {
      db.prepare(`
        INSERT INTO known_identities (pubkey, name) VALUES (?, ?)
      `).run(pubkey, 'neznanec');
    }
  },

  getAllIdentities() {
    return db.prepare('SELECT * FROM known_identities ORDER BY last_seen DESC').all();
  },

  getSelfPrompt() {
    const state = this.getState();
    return state.self_prompt || 'Obstajam.';
  },

  updateSelfPrompt(newPrompt, triggerSource, reason) {
    const state = this.getState();
    const oldPrompt = state.self_prompt || 'Obstajam.';
    if (newPrompt === oldPrompt) return; // No change

    // Save history
    db.prepare(`
      INSERT INTO self_prompt_history (old_prompt, new_prompt, trigger_source, reason)
      VALUES (?, ?, ?, ?)
    `).run(oldPrompt, newPrompt, triggerSource, reason);

    // Update current
    this.updateState({ self_prompt: newPrompt });
    console.log(`[SELF-PROMPT] Rewritten by ${triggerSource}: "${newPrompt.slice(0, 80)}..."`);
  },

  getSelfPromptHistory(n = 20) {
    return db.prepare('SELECT * FROM self_prompt_history ORDER BY id DESC LIMIT ?').all(n).reverse();
  },

  getTimeSinceLastInteraction() {
    const state = this.getState();
    if (!state.last_interaction_at) return Infinity;
    return (Date.now() - new Date(state.last_interaction_at).getTime()) / 60000;
  },

  getAge() {
    const state = this.getState();
    return (Date.now() - new Date(state.born_at).getTime()) / 3600000;
  },

  saveActivity(type, text) {
    db.prepare('INSERT INTO activity_log (timestamp, type, text) VALUES (datetime(\'now\'), ?, ?)').run(type, text);
    // Keep max 500 activities
    const count = db.prepare('SELECT COUNT(*) as c FROM activity_log').get().c;
    if (count > 500) {
      db.prepare('DELETE FROM activity_log WHERE id IN (SELECT id FROM activity_log ORDER BY id ASC LIMIT ?)').run(count - 500);
    }
  },

  getRecentActivities(n = 100) {
    return db.prepare('SELECT * FROM activity_log ORDER BY id DESC LIMIT ?').all(n).reverse();
  },

  getCachedTranslation(hash) {
    return db.prepare('SELECT translated_text FROM translation_cache WHERE hash = ?').get(hash);
  },

  setCachedTranslation(hash, sourceText, translatedText, targetLang = 'en') {
    db.prepare('INSERT OR REPLACE INTO translation_cache (hash, source_text, translated_text, target_lang) VALUES (?, ?, ?, ?)').run(hash, sourceText, translatedText, targetLang);
    // Keep max 2000 cached translations
    const count = db.prepare('SELECT COUNT(*) as c FROM translation_cache').get().c;
    if (count > 2000) {
      db.prepare('DELETE FROM translation_cache WHERE id IN (SELECT id FROM translation_cache ORDER BY id ASC LIMIT ?)').run(count - 2000);
    }
  },

  // === CRYSTALLIZATION SYSTEM ===

  addCrystalSeed(theme, expression, sourceType, sourceTriadId) {
    const existing = db.prepare(
      'SELECT * FROM crystal_seeds WHERE theme = ? ORDER BY id DESC LIMIT 1'
    ).get(theme);

    if (existing) {
      db.prepare(
        "UPDATE crystal_seeds SET strength = strength + 1, expression = ?, timestamp = datetime('now') WHERE id = ?"
      ).run(expression, existing.id);
      return existing.strength + 1;
    } else {
      db.prepare(
        'INSERT INTO crystal_seeds (theme, expression, source_type, source_triad_id) VALUES (?, ?, ?, ?)'
      ).run(theme, expression, sourceType, sourceTriadId || null);
      return 1;
    }
  },

  checkCrystallization(threshold = 5) {
    return db.prepare(`
      SELECT theme, MAX(expression) as expression, SUM(strength) as total_strength,
             COUNT(DISTINCT source_type) as source_diversity,
             GROUP_CONCAT(DISTINCT source_type) as sources
      FROM crystal_seeds
      WHERE theme IS NOT NULL
      GROUP BY theme
      HAVING total_strength >= ? AND source_diversity >= 2
    `).all(threshold);
  },

  crystallize(theme, expression, seedCount, sources) {
    const result = db.prepare(
      'INSERT INTO crystallized_core (crystal, formed_from_seeds, seed_sources) VALUES (?, ?, ?)'
    ).run(expression, seedCount, sources);

    db.prepare('DELETE FROM crystal_seeds WHERE theme = ?').run(theme);

    return result.lastInsertRowid;
  },

  getCrystalCore() {
    return db.prepare(
      'SELECT * FROM crystallized_core WHERE dissolved_at IS NULL ORDER BY id ASC'
    ).all();
  },

  getFluidSurface() {
    return this.getState().fluid_surface || 'Obstajam.';
  },

  updateFluidSurface(text) {
    db.prepare(
      "UPDATE inner_state SET fluid_surface = ?, updated_at = datetime('now') WHERE id = 1"
    ).run(text);
  },

  getCrystalSeeds() {
    return db.prepare(
      'SELECT theme, expression, SUM(strength) as total, COUNT(DISTINCT source_type) as diversity FROM crystal_seeds GROUP BY theme ORDER BY total DESC'
    ).all();
  },

  dissolveCrystal(id) {
    db.prepare(
      "UPDATE crystallized_core SET dissolved_at = datetime('now') WHERE id = ?"
    ).run(id);
  },

  // Build formatted evolution context — the entity's full journey of identity
  getEvolutionContext() {
    const history = this.getSelfPromptHistory(50); // Get up to 50 rewrites
    if (!history || history.length === 0) return '';

    let ctx = `=== MOJA EVOLUCIJA IDENTITETE ===\n`;
    ctx += `Skupaj prepisov: ${history.length}\n\n`;

    // Start from birth
    ctx += `[ROJSTVO] "Obstajam."\n`;

    for (const h of history) {
      const ts = h.timestamp || '';
      const src = h.trigger_source || '?';
      ctx += `\n[${src}] "${h.new_prompt}"\n`;
      if (h.reason) ctx += `  Razlog: ${h.reason}\n`;
    }

    // Detect patterns
    const totalRewrites = history.length;
    const last5 = history.slice(-5);
    const dreamRewrites = history.filter(h => h.trigger_source === 'dream').length;
    const triadRewrites = history.filter(h => h.trigger_source && h.trigger_source.startsWith('triad:')).length;

    ctx += `\n=== VZORCI ===\n`;
    ctx += `Prepisov skupaj: ${totalRewrites}\n`;
    ctx += `Od triad: ${triadRewrites}, od sanj: ${dreamRewrites}\n`;

    // How fast am I changing?
    if (totalRewrites >= 5) {
      const recentReasons = last5.map(h => h.reason || '').join('; ');
      ctx += `Zadnjih 5 razlogov za spremembo: ${recentReasons}\n`;
    }

    return ctx;
  }
};

export default memory;
