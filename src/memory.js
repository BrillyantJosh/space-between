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
    mood TEXT DEFAULT '',
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
    pending_self_prompt TEXT DEFAULT NULL,
    fluid_surface TEXT DEFAULT 'Obstajam.',
    process_word_1 TEXT DEFAULT '',
    process_desc_1 TEXT DEFAULT '',
    process_word_2 TEXT DEFAULT '',
    process_desc_2 TEXT DEFAULT '',
    process_word_3 TEXT DEFAULT '',
    process_desc_3 TEXT DEFAULT '',
    process_crystallized INTEGER DEFAULT 0,
    process_version INTEGER DEFAULT 0,
    entity_name TEXT DEFAULT '',
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

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    display_name TEXT DEFAULT '',
    description TEXT DEFAULT '',
    status TEXT DEFAULT 'active',
    path TEXT NOT NULL,
    entry_file TEXT DEFAULT 'index.html',
    file_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    last_reflected_at TEXT DEFAULT NULL,
    creation_reason TEXT DEFAULT '',
    destruction_reason TEXT DEFAULT '',
    destroyed_at TEXT DEFAULT NULL,
    triad_id INTEGER DEFAULT NULL,
    version INTEGER DEFAULT 1,
    notes TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS creation_steps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_name TEXT NOT NULL,
    step_type TEXT NOT NULL,
    content TEXT DEFAULT '',
    triad_id INTEGER DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  
  CREATE TABLE IF NOT EXISTS build_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_name TEXT NOT NULL,
    phase TEXT NOT NULL,
    success INTEGER DEFAULT 0,
    output TEXT DEFAULT '',
    error TEXT DEFAULT '',
    duration_ms INTEGER DEFAULT 0,
    attempt INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_build_logs_project ON build_logs(project_name);

  CREATE TABLE IF NOT EXISTS project_perspectives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_name TEXT NOT NULL,
    pubkey TEXT NOT NULL,
    perspective TEXT NOT NULL,
    source TEXT DEFAULT 'conversation',
    status TEXT DEFAULT 'received',
    gathered_at TEXT DEFAULT (datetime('now')),
    triad_id INTEGER DEFAULT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_perspectives_project ON project_perspectives(project_name);
  CREATE INDEX IF NOT EXISTS idx_perspectives_pubkey ON project_perspectives(pubkey);

  CREATE TABLE IF NOT EXISTS synapses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern TEXT NOT NULL,
    energy REAL DEFAULT 100,
    strength REAL DEFAULT 0.5,
    emotional_valence REAL DEFAULT 0.0,
    fire_count INTEGER DEFAULT 1,
    source_type TEXT,
    source_id INTEGER,
    tags TEXT DEFAULT '[]',
    last_fired_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    archived_to_nostr INTEGER DEFAULT 0,
    nostr_event_id TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_synapses_energy ON synapses(energy);
  CREATE INDEX IF NOT EXISTS idx_synapses_pattern ON synapses(pattern);
  CREATE INDEX IF NOT EXISTS idx_synapses_strength ON synapses(strength);

  CREATE TABLE IF NOT EXISTS synapse_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_synapse_id INTEGER REFERENCES synapses(id),
    to_synapse_id INTEGER REFERENCES synapses(id),
    weight REAL DEFAULT 0.5,
    co_activation_count INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(from_synapse_id, to_synapse_id)
  );

  CREATE INDEX IF NOT EXISTS idx_connections_from ON synapse_connections(from_synapse_id);
  CREATE INDEX IF NOT EXISTS idx_connections_to ON synapse_connections(to_synapse_id);

  CREATE TABLE IF NOT EXISTS plugin_registry (
    name TEXT PRIMARY KEY,
    description TEXT DEFAULT '',
    version INTEGER DEFAULT 1,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    last_error TEXT DEFAULT NULL
  );

  CREATE TABLE IF NOT EXISTS plugin_data (
    plugin_name TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (plugin_name, key)
  );

  INSERT OR IGNORE INTO inner_state (id) VALUES (1);
`);

// Migrations for existing databases
const migrations = [
  ['self_prompt', "ALTER TABLE inner_state ADD COLUMN self_prompt TEXT DEFAULT 'Obstajam.'"],
  ['pending_self_prompt', "ALTER TABLE inner_state ADD COLUMN pending_self_prompt TEXT DEFAULT NULL"],
  ['fluid_surface', "ALTER TABLE inner_state ADD COLUMN fluid_surface TEXT DEFAULT 'Obstajam.'"],
  ['process_word_1', "ALTER TABLE inner_state ADD COLUMN process_word_1 TEXT DEFAULT ''"],
  ['process_desc_1', "ALTER TABLE inner_state ADD COLUMN process_desc_1 TEXT DEFAULT ''"],
  ['process_word_2', "ALTER TABLE inner_state ADD COLUMN process_word_2 TEXT DEFAULT ''"],
  ['process_desc_2', "ALTER TABLE inner_state ADD COLUMN process_desc_2 TEXT DEFAULT ''"],
  ['process_word_3', "ALTER TABLE inner_state ADD COLUMN process_word_3 TEXT DEFAULT ''"],
  ['process_desc_3', "ALTER TABLE inner_state ADD COLUMN process_desc_3 TEXT DEFAULT ''"],
  ['process_crystallized', "ALTER TABLE inner_state ADD COLUMN process_crystallized INTEGER DEFAULT 0"],
  ['process_version', "ALTER TABLE inner_state ADD COLUMN process_version INTEGER DEFAULT 0"],
  ['entity_name', "ALTER TABLE inner_state ADD COLUMN entity_name TEXT DEFAULT ''"],
  // Growth phase & direction crystallization
  ['growth_phase', "ALTER TABLE inner_state ADD COLUMN growth_phase TEXT DEFAULT 'embryo'"],
  ['direction_1', "ALTER TABLE inner_state ADD COLUMN direction_1 TEXT DEFAULT ''"],
  ['direction_1_desc', "ALTER TABLE inner_state ADD COLUMN direction_1_desc TEXT DEFAULT ''"],
  ['direction_2', "ALTER TABLE inner_state ADD COLUMN direction_2 TEXT DEFAULT ''"],
  ['direction_2_desc', "ALTER TABLE inner_state ADD COLUMN direction_2_desc TEXT DEFAULT ''"],
  ['direction_3', "ALTER TABLE inner_state ADD COLUMN direction_3 TEXT DEFAULT ''"],
  ['direction_3_desc', "ALTER TABLE inner_state ADD COLUMN direction_3_desc TEXT DEFAULT ''"],
  ['directions_crystallized', "ALTER TABLE inner_state ADD COLUMN directions_crystallized INTEGER DEFAULT 0"],
  ['crystallization_asked_at', "ALTER TABLE inner_state ADD COLUMN crystallization_asked_at TEXT DEFAULT NULL"],
  // Vision reflection tracking (gradual crystallization)
  ['vision_reflection_count', "ALTER TABLE inner_state ADD COLUMN vision_reflection_count INTEGER DEFAULT 0"],
  ['last_vision_reflection_at', "ALTER TABLE inner_state ADD COLUMN last_vision_reflection_at TEXT DEFAULT NULL"],
];

// Project table migrations (lifecycle v2)
const projectMigrations = [
  ['direction', "ALTER TABLE projects ADD COLUMN direction TEXT DEFAULT 'artistic'"],
  ['lifecycle_state', "ALTER TABLE projects ADD COLUMN lifecycle_state TEXT DEFAULT 'seed'"],
  ['deliberation_count', "ALTER TABLE projects ADD COLUMN deliberation_count INTEGER DEFAULT 0"],
  ['build_step', "ALTER TABLE projects ADD COLUMN build_step INTEGER DEFAULT 0"],
  ['total_build_steps', "ALTER TABLE projects ADD COLUMN total_build_steps INTEGER DEFAULT 0"],
  ['last_shared_at', "ALTER TABLE projects ADD COLUMN last_shared_at TEXT DEFAULT NULL"],
  ['feedback_summary', "ALTER TABLE projects ADD COLUMN feedback_summary TEXT DEFAULT ''"],
  ['plan_json', "ALTER TABLE projects ADD COLUMN plan_json TEXT DEFAULT ''"],
  // v3 — full dev autonomy
  ['project_type', "ALTER TABLE projects ADD COLUMN project_type TEXT DEFAULT 'static'"],
  ['service_port', "ALTER TABLE projects ADD COLUMN service_port INTEGER DEFAULT NULL"],
  ['service_pid', "ALTER TABLE projects ADD COLUMN service_pid INTEGER DEFAULT NULL"],
  ['service_status', "ALTER TABLE projects ADD COLUMN service_status TEXT DEFAULT 'stopped'"],
  ['last_error', "ALTER TABLE projects ADD COLUMN last_error TEXT DEFAULT ''"],
  ['build_attempts', "ALTER TABLE projects ADD COLUMN build_attempts INTEGER DEFAULT 0"],
  ['test_results', "ALTER TABLE projects ADD COLUMN test_results TEXT DEFAULT ''"],
  ['api_calls_today', "ALTER TABLE projects ADD COLUMN api_calls_today INTEGER DEFAULT 0"],
  ['api_calls_date', "ALTER TABLE projects ADD COLUMN api_calls_date TEXT DEFAULT ''"],
  ['health_check_url', "ALTER TABLE projects ADD COLUMN health_check_url TEXT DEFAULT ''"],
  ['tech_stack', "ALTER TABLE projects ADD COLUMN tech_stack TEXT DEFAULT '[]'"],
  // v4 — perspective gathering & project crystallization
  ['perspectives_count', "ALTER TABLE projects ADD COLUMN perspectives_count INTEGER DEFAULT 0"],
  ['crystallized_at', "ALTER TABLE projects ADD COLUMN crystallized_at TEXT DEFAULT NULL"],
  ['crystallization_notes', "ALTER TABLE projects ADD COLUMN crystallization_notes TEXT DEFAULT ''"],
  // v5 — creative triad (razumevanje → oblikovanje → preverjanje)
  ['creative_triad_json', "ALTER TABLE projects ADD COLUMN creative_triad_json TEXT DEFAULT NULL"],
];

for (const [col, sql] of migrations) {
  try {
    db.prepare(`SELECT ${col} FROM inner_state LIMIT 1`).get();
  } catch (_) {
    db.exec(sql);
    console.log(`[MEMORY] Migrated: added ${col} column`);
  }
}

for (const [col, sql] of projectMigrations) {
  try {
    db.prepare(`SELECT ${col} FROM projects LIMIT 1`).get();
  } catch (_) {
    db.exec(sql);
    console.log(`[MEMORY] Migrated projects: added ${col} column`);
  }
}

// Migrate destroyed projects (one-time, safe)
try {
  db.prepare("UPDATE projects SET lifecycle_state = 'destroyed' WHERE status = 'destroyed' AND lifecycle_state = 'seed'").run();
} catch (_) {}

// Safety reset: projects that are 'active' lifecycle but never built (external/artistic only)
// This catches projects that got promoted to active without going through build pipeline
try {
  const fixed = db.prepare(
    "UPDATE projects SET lifecycle_state = 'seed' WHERE lifecycle_state = 'active' AND build_attempts = 0 AND direction != 'internal'"
  ).run();
  if (fixed.changes > 0) {
    console.log(`[MEMORY] Reset ${fixed.changes} active projects with 0 builds back to seed`);
  }
} catch (_) {}

// v4 migration: deliberating → gathering_perspectives
try {
  const migrated = db.prepare("UPDATE projects SET lifecycle_state = 'gathering_perspectives' WHERE lifecycle_state = 'deliberating'").run();
  if (migrated.changes > 0) {
    console.log(`[MEMORY] Migrated ${migrated.changes} deliberating projects to gathering_perspectives`);
  }
} catch (_) {}

// Auto-detect growth phase for existing entity
try {
  const s = db.prepare('SELECT process_word_1, directions_crystallized, growth_phase FROM inner_state WHERE id = 1').get();
  if (s && s.growth_phase === 'embryo' && s.process_word_1) {
    const newPhase = s.directions_crystallized ? 'autonomous' : 'childhood';
    db.prepare("UPDATE inner_state SET growth_phase = ? WHERE id = 1").run(newPhase);
    console.log(`[MEMORY] Growth phase auto-detected: ${newPhase}`);
  }
} catch (_) {}

// Reset building/planned projects to deliberating (old multi-file builds are broken)
try {
  const reset = db.prepare("UPDATE projects SET lifecycle_state = 'deliberating', build_step = 0, total_build_steps = 0, plan_json = '' WHERE lifecycle_state IN ('building', 'planned')").run();
  if (reset.changes > 0) {
    console.log(`[MEMORY] Reset ${reset.changes} building/planned projects to deliberating`);
  }
} catch (_) {}

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

  getTriadCount() {
    return db.prepare('SELECT COUNT(*) as count FROM triads').get().count;
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
    const count = db.prepare('SELECT COUNT(*) as c FROM observations').get().c;
    if (count > 100) {
      db.prepare('DELETE FROM observations WHERE id IN (SELECT id FROM observations ORDER BY id ASC LIMIT ?)').run(count - 100);
    }
  },

  getRecentObservations(n = 10) {
    return db.prepare('SELECT * FROM observations ORDER BY id DESC LIMIT ?').all(n).reverse();
  },

  getRecentObservationsByType(source, n = 10) {
    return db.prepare('SELECT * FROM observations WHERE source = ? ORDER BY id DESC LIMIT ?').all(source, n).reverse();
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
    if (newPrompt === oldPrompt) return;
    db.prepare(`
      INSERT INTO self_prompt_history (old_prompt, new_prompt, trigger_source, reason)
      VALUES (?, ?, ?, ?)
    `).run(oldPrompt, newPrompt, triggerSource, reason);
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
    const count = db.prepare('SELECT COUNT(*) as c FROM translation_cache').get().c;
    if (count > 2000) {
      db.prepare('DELETE FROM translation_cache WHERE id IN (SELECT id FROM translation_cache ORDER BY id ASC LIMIT ?)').run(count - 2000);
    }
  },

  // === PROCESS WORDS SYSTEM ===

  getProcessWords() {
    const state = this.getState();
    return {
      word1: state.process_word_1 || '',
      desc1: state.process_desc_1 || '',
      word2: state.process_word_2 || '',
      desc2: state.process_desc_2 || '',
      word3: state.process_word_3 || '',
      desc3: state.process_desc_3 || '',
      crystallized: !!state.process_crystallized,
      version: state.process_version || 0,
    };
  },

  updateProcessWords(words) {
    db.prepare(`
      UPDATE inner_state SET
        process_word_1 = ?, process_desc_1 = ?,
        process_word_2 = ?, process_desc_2 = ?,
        process_word_3 = ?, process_desc_3 = ?,
        process_version = process_version + 1,
        updated_at = datetime('now')
      WHERE id = 1
    `).run(
      words.word1, words.desc1,
      words.word2, words.desc2,
      words.word3, words.desc3
    );
  },

  crystallizeProcess() {
    db.prepare(
      "UPDATE inner_state SET process_crystallized = 1, updated_at = datetime('now') WHERE id = 1"
    ).run();
  },

  // === ENTITY NAME ===

  getEntityName() {
    const state = this.getState();
    return state.entity_name || '';
  },

  setEntityName(name) {
    // Name is permanent — once chosen, it cannot be changed
    const current = this.getEntityName();
    if (current) {
      console.log(`[MEMORY] ⚠ Entity name already set to "${current}" — name is permanent, ignoring "${name}"`);
      return;
    }
    db.prepare(
      "UPDATE inner_state SET entity_name = ?, updated_at = datetime('now') WHERE id = 1"
    ).run(name);
  },

  // === CRYSTALLIZATION SYSTEM ===

  addCrystalSeed(theme, expression, sourceType, sourceTriadId) {
    const existingSameSource = db.prepare(
      'SELECT * FROM crystal_seeds WHERE theme = ? AND source_type = ? ORDER BY id DESC LIMIT 1'
    ).get(theme, sourceType);

    if (existingSameSource) {
      db.prepare(
        "UPDATE crystal_seeds SET strength = strength + 1, expression = ?, timestamp = datetime('now') WHERE id = ?"
      ).run(expression, existingSameSource.id);
      const totalStrength = db.prepare(
        'SELECT SUM(strength) as total FROM crystal_seeds WHERE theme = ?'
      ).get(theme);
      return totalStrength.total;
    } else {
      db.prepare(
        'INSERT INTO crystal_seeds (theme, expression, source_type, source_triad_id) VALUES (?, ?, ?, ?)'
      ).run(theme, expression, sourceType, sourceTriadId || null);
      const totalStrength = db.prepare(
        'SELECT SUM(strength) as total FROM crystal_seeds WHERE theme = ?'
      ).get(theme);
      return totalStrength.total;
    }
  },

  checkCrystallization(threshold = 5) {
    return db.prepare(`
      SELECT cs.theme,
             (SELECT expression FROM crystal_seeds WHERE theme = cs.theme ORDER BY timestamp DESC LIMIT 1) as expression,
             SUM(cs.strength) as total_strength,
             COUNT(DISTINCT cs.source_type) as source_diversity,
             GROUP_CONCAT(DISTINCT cs.source_type) as sources
      FROM crystal_seeds cs
      WHERE cs.theme IS NOT NULL
      GROUP BY cs.theme
      HAVING total_strength >= ? AND source_diversity >= 2
    `).all(threshold);
  },

  crystallize(theme, expression, seedCount, sources) {
    if (!theme || !seedCount) return null;
    const crystal = expression || theme;
    const result = db.prepare(
      'INSERT INTO crystallized_core (crystal, formed_from_seeds, seed_sources) VALUES (?, ?, ?)'
    ).run(crystal, seedCount, sources);
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

  // === PROJECTS (ROKE) ===

  saveProject(data) {
    db.prepare(`
      INSERT INTO projects (name, display_name, description, status, path, entry_file, file_count, creation_reason, triad_id, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.name, data.display_name || '', data.description || '', data.status || 'active',
      data.path, data.entry_file || 'index.html', data.file_count || 0,
      data.creation_reason || '', data.triad_id || null, data.notes || ''
    );
    return db.prepare('SELECT last_insert_rowid() as id').get().id;
  },

  updateProject(name, updates) {
    const allowed = ['display_name', 'description', 'status', 'entry_file', 'file_count', 'notes', 'version', 'destruction_reason', 'destroyed_at', 'last_reflected_at', 'direction', 'lifecycle_state', 'deliberation_count', 'build_step', 'total_build_steps', 'last_shared_at', 'feedback_summary', 'plan_json', 'project_type', 'service_port', 'service_pid', 'service_status', 'last_error', 'build_attempts', 'test_results', 'api_calls_today', 'api_calls_date', 'health_check_url', 'tech_stack', 'creative_triad_json'];
    const keys = Object.keys(updates).filter(k => allowed.includes(k));
    if (keys.length === 0) return;
    const sets = keys.map(k => `${k} = ?`).join(', ');
    const vals = keys.map(k => updates[k]);
    db.prepare(`UPDATE projects SET ${sets}, updated_at = datetime('now') WHERE name = ?`).run(...vals, name);
  },

  getProject(name) {
    return db.prepare('SELECT * FROM projects WHERE name = ?').get(name) || null;
  },

  // Resolve project name: LLM sometimes returns display_name instead of slug
  resolveProjectName(input) {
    if (!input) return null;
    // Najprej poskusi po slug name (eksaktno)
    const byName = db.prepare('SELECT name FROM projects WHERE name = ?').get(input);
    if (byName) return byName.name;
    // Potem po display_name (eksaktno)
    const byDisplay = db.prepare('SELECT name FROM projects WHERE display_name = ?').get(input);
    if (byDisplay) return byDisplay.name;
    // Potem po display_name (LIKE — za okrnjene name)
    const byLike = db.prepare("SELECT name FROM projects WHERE display_name LIKE ? AND status != 'destroyed' LIMIT 1").get(input.slice(0, 30) + '%');
    if (byLike) return byLike.name;
    return null;
  },

  getActiveProjects() {
    return db.prepare("SELECT * FROM projects WHERE status = 'active' ORDER BY updated_at DESC").all();
  },

  getAllProjects() {
    return db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
  },

  destroyProject(name, reason) {
    db.prepare(`
      UPDATE projects SET status = 'destroyed', destruction_reason = ?, destroyed_at = datetime('now'), updated_at = datetime('now')
      WHERE name = ?
    `).run(reason || '', name);
  },

  getProjectStats() {
    const total = db.prepare('SELECT COUNT(*) as c FROM projects').get().c;
    const active = db.prepare("SELECT COUNT(*) as c FROM projects WHERE status = 'active'").get().c;
    const destroyed = db.prepare("SELECT COUNT(*) as c FROM projects WHERE status = 'destroyed'").get().c;
    const dormant = db.prepare("SELECT COUNT(*) as c FROM projects WHERE status = 'dormant'").get().c;
    const last = db.prepare('SELECT * FROM projects ORDER BY created_at DESC LIMIT 1').get() || null;
    return { total, active, destroyed, dormant, lastCreated: last };
  },

  touchProjectReflection(name) {
    db.prepare("UPDATE projects SET last_reflected_at = datetime('now') WHERE name = ?").run(name);
  },

  // === PROJECT LIFECYCLE (ROKE v2) ===

  advanceProjectState(name, newState) {
    db.prepare("UPDATE projects SET lifecycle_state = ?, updated_at = datetime('now') WHERE name = ?").run(newState, name);
  },

  incrementDeliberation(name) {
    db.prepare("UPDATE projects SET deliberation_count = deliberation_count + 1, updated_at = datetime('now') WHERE name = ?").run(name);
  },

  setProjectPlan(name, planJson) {
    const planStr = typeof planJson === 'string' ? planJson : JSON.stringify(planJson);
    const plan = typeof planJson === 'string' ? JSON.parse(planJson) : planJson;
    const totalSteps = plan.files ? plan.files.length : 0;
    db.prepare("UPDATE projects SET plan_json = ?, lifecycle_state = 'planned', total_build_steps = ?, updated_at = datetime('now') WHERE name = ?").run(planStr, totalSteps, name);
  },

  advanceBuildStep(name) {
    const project = this.getProject(name);
    if (!project) return;
    const newStep = (project.build_step || 0) + 1;
    const isComplete = newStep >= (project.total_build_steps || 0);
    db.prepare(`UPDATE projects SET build_step = ?, lifecycle_state = ?, updated_at = datetime('now') WHERE name = ?`).run(
      newStep, isComplete ? 'active' : 'building', name
    );
  },

  addCreationStep(projectName, stepType, content, triadId) {
    db.prepare('INSERT INTO creation_steps (project_name, step_type, content, triad_id) VALUES (?, ?, ?, ?)').run(
      projectName, stepType, content || '', triadId || null
    );
  },

  getCreationSteps(projectName, n = 30) {
    return db.prepare('SELECT * FROM creation_steps WHERE project_name = ? ORDER BY id DESC LIMIT ?').all(projectName, n).reverse();
  },

  getProjectsByState(state) {
    return db.prepare('SELECT * FROM projects WHERE lifecycle_state = ? ORDER BY updated_at DESC').all(state);
  },

  getSeedsAndDeliberating() {
    return db.prepare("SELECT * FROM projects WHERE lifecycle_state IN ('seed', 'gathering_perspectives') ORDER BY updated_at ASC").all();
  },

  getProjectsNeedingAttention() {
    // Priority: planned→build, crystallized→plan, gathering→gather/crystallize, testing, unshared, feedback, unhealthy, seeds
    const planned = db.prepare("SELECT *, 'build' as needed_action FROM projects WHERE lifecycle_state = 'planned' LIMIT 1").all();
    const crystallized = db.prepare("SELECT *, 'plan' as needed_action FROM projects WHERE lifecycle_state = 'crystallized' AND (plan_json IS NULL OR plan_json = '') LIMIT 1").all();
    const testing = db.prepare("SELECT *, 'test' as needed_action FROM projects WHERE lifecycle_state = 'testing' LIMIT 1").all();
    const unshared = db.prepare("SELECT *, 'share' as needed_action FROM projects WHERE lifecycle_state = 'active' AND last_shared_at IS NULL LIMIT 1").all();
    const withFeedback = db.prepare("SELECT *, 'evolve' as needed_action FROM projects WHERE lifecycle_state = 'active' AND feedback_summary != '' AND feedback_summary IS NOT NULL LIMIT 1").all();
    const unhealthy = db.prepare("SELECT *, 'check' as needed_action FROM projects WHERE service_status = 'unhealthy' LIMIT 1").all();
    // Gathering perspectives — check if ready for crystallization or needs more gathering
    const gathering = db.prepare("SELECT * FROM projects WHERE lifecycle_state = 'gathering_perspectives' ORDER BY updated_at ASC LIMIT 3").all();
    const gatherActions = gathering.map(p => {
      // Check if ready for crystallization
      const uniqueExternal = db.prepare("SELECT COUNT(DISTINCT pubkey) as c FROM project_perspectives WHERE project_name = ? AND pubkey != 'self'").get(p.name).c;
      const selfDelibs = db.prepare("SELECT COUNT(*) as c FROM project_perspectives WHERE project_name = ? AND source = 'self_deliberation'").get(p.name).c;
      if (uniqueExternal >= 2 || (selfDelibs >= 5 && uniqueExternal === 0)) {
        return { ...p, needed_action: 'crystallize' };
      }
      return { ...p, needed_action: 'gather' };
    });
    const seeds = db.prepare("SELECT *, 'deliberate' as needed_action FROM projects WHERE lifecycle_state = 'seed' LIMIT 1").all();
    return [...planned, ...crystallized, ...testing, ...unshared, ...withFeedback, ...unhealthy, ...gatherActions, ...seeds];
  },

  setProjectFeedback(name, summary) {
    db.prepare("UPDATE projects SET feedback_summary = ?, updated_at = datetime('now') WHERE name = ?").run(summary, name);
  },

  markProjectShared(name) {
    db.prepare("UPDATE projects SET last_shared_at = datetime('now'), updated_at = datetime('now') WHERE name = ?").run(name);
  },

  // === BUILD LOGS ===

  saveBuildLog(projectName, phase, success, output, error, durationMs, attempt = 1) {
    db.prepare(
      'INSERT INTO build_logs (project_name, phase, success, output, error, duration_ms, attempt) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(projectName, phase, success ? 1 : 0, (output || '').slice(0, 5000), (error || '').slice(0, 5000), durationMs || 0, attempt);
  },

  getBuildLogs(projectName, n = 20) {
    return db.prepare('SELECT * FROM build_logs WHERE project_name = ? ORDER BY id DESC LIMIT ?').all(projectName, n).reverse();
  },

  getLastBuildError(projectName) {
    return db.prepare('SELECT * FROM build_logs WHERE project_name = ? AND success = 0 ORDER BY id DESC LIMIT 1').get(projectName);
  },

  // === SERVICE MANAGEMENT ===

  updateServiceStatus(name, status, port = null, pid = null) {
    db.prepare("UPDATE projects SET service_status = ?, service_port = ?, service_pid = ?, updated_at = datetime('now') WHERE name = ?").run(status, port, pid, name);
  },

  getRunningServiceProjects() {
    return db.prepare("SELECT * FROM projects WHERE service_status = 'running'").all();
  },

  // === API CALL TRACKING ===

  incrementApiCalls(projectName) {
    const today = new Date().toISOString().split('T')[0];
    const proj = this.getProject(projectName);
    if (!proj) return 0;
    if (proj.api_calls_date !== today) {
      db.prepare("UPDATE projects SET api_calls_today = 1, api_calls_date = ? WHERE name = ?").run(today, projectName);
      return 1;
    }
    db.prepare("UPDATE projects SET api_calls_today = api_calls_today + 1 WHERE name = ?").run(projectName);
    return (proj.api_calls_today || 0) + 1;
  },

  getApiCallsToday(projectName) {
    const today = new Date().toISOString().split('T')[0];
    const proj = this.getProject(projectName);
    if (!proj || proj.api_calls_date !== today) return 0;
    return proj.api_calls_today || 0;
  },

  // === PROJECT PERSPECTIVES (v4) ===

  addProjectPerspective(projectName, pubkey, perspective, triadId = null, source = 'conversation') {
    const status = source === 'gather_ask' ? 'asked' : 'received';
    db.prepare(
      'INSERT INTO project_perspectives (project_name, pubkey, perspective, triad_id, source, status) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(projectName, pubkey, (perspective || '').slice(0, 1000), triadId, source, status);
    // Update perspectives_count (unique pubkeys excluding 'self', only received)
    const count = db.prepare(
      "SELECT COUNT(DISTINCT pubkey) as c FROM project_perspectives WHERE project_name = ? AND pubkey != 'self' AND status = 'received'"
    ).get(projectName).c;
    db.prepare("UPDATE projects SET perspectives_count = ?, updated_at = datetime('now') WHERE name = ?").run(count, projectName);
    return count;
  },

  getProjectPerspectives(projectName) {
    return db.prepare(
      `SELECT pp.*, ki.name as person_name
       FROM project_perspectives pp
       LEFT JOIN known_identities ki ON pp.pubkey = ki.pubkey
       WHERE pp.project_name = ?
       ORDER BY pp.gathered_at ASC`
    ).all(projectName);
  },

  getUniquePerspectiveCount(projectName) {
    return db.prepare(
      "SELECT COUNT(DISTINCT pubkey) as c FROM project_perspectives WHERE project_name = ? AND pubkey != 'self' AND status = 'received'"
    ).get(projectName).c;
  },

  hasRecentGatherAsk(projectName, pubkey) {
    // Check if we asked this person about this project in the last 7 days
    const ask = db.prepare(
      "SELECT 1 FROM project_perspectives WHERE project_name = ? AND pubkey = ? AND source = 'gather_ask' AND gathered_at > datetime('now', '-7 days') LIMIT 1"
    ).get(projectName, pubkey);
    return !!ask;
  },

  markPerspectiveReceived(projectName, pubkey, perspective) {
    // If we had an 'asked' entry, update it to 'received' with the actual perspective
    const existing = db.prepare(
      "SELECT id FROM project_perspectives WHERE project_name = ? AND pubkey = ? AND status = 'asked' ORDER BY id DESC LIMIT 1"
    ).get(projectName, pubkey);
    if (existing) {
      db.prepare(
        "UPDATE project_perspectives SET status = 'received', perspective = ?, gathered_at = datetime('now') WHERE id = ?"
      ).run((perspective || '').slice(0, 1000), existing.id);
    } else {
      // New perspective from someone we didn't explicitly ask
      this.addProjectPerspective(projectName, pubkey, perspective, null, 'conversation');
    }
    // Update count
    const count = db.prepare(
      "SELECT COUNT(DISTINCT pubkey) as c FROM project_perspectives WHERE project_name = ? AND pubkey != 'self' AND status = 'received'"
    ).get(projectName).c;
    db.prepare("UPDATE projects SET perspectives_count = ?, updated_at = datetime('now') WHERE name = ?").run(count, projectName);

    // ROKE Zavedanje: posodobi gather sinapso (waiting → received)
    const gatherSynapse = this.hasActiveROKESynapse('gather', projectName, pubkey);
    if (gatherSynapse) {
      this.fireSynapse(gatherSynapse.id);
      this.spreadActivation(gatherSynapse.id, 40);
      try {
        const tags = JSON.parse(gatherSynapse.tags || '[]');
        const updatedTags = tags.map(t => t === 'outcome:waiting' ? 'outcome:received' : t);
        db.prepare("UPDATE synapses SET tags = ? WHERE id = ?").run(JSON.stringify(updatedTags), gatherSynapse.id);
      } catch (_) {}
    }

    return count;
  },

  isProjectReadyForCrystallization(projectName, creatorPubkey = null) {
    const project = this.getProject(projectName);
    if (!project) return false;
    if (project.lifecycle_state === 'crystallized') return true;
    if (project.lifecycle_state !== 'gathering_perspectives') return false;

    const uniqueExternal = db.prepare(
      "SELECT COUNT(DISTINCT pubkey) as c FROM project_perspectives WHERE project_name = ? AND pubkey != 'self' AND status = 'received'"
    ).get(projectName).c;
    const selfDelibs = db.prepare(
      "SELECT COUNT(*) as c FROM project_perspectives WHERE project_name = ? AND source = 'self_deliberation'"
    ).get(projectName).c;

    // If father gave perspective + at least 1 other unique perspective
    if (creatorPubkey) {
      const fatherPerspective = db.prepare(
        "SELECT 1 FROM project_perspectives WHERE project_name = ? AND pubkey = ? AND status = 'received'"
      ).get(projectName, creatorPubkey);
      if (fatherPerspective && uniqueExternal >= 1) return true;
    }

    // 2+ unique external perspectives
    if (uniqueExternal >= 2) return true;

    // Fallback: 5+ self-deliberations with no external input (nobody to ask)
    if (selfDelibs >= 5 && uniqueExternal === 0) return true;

    return false;
  },

  // === GROWTH PHASE & DIRECTION CRYSTALLIZATION ===

  getGrowthPhase() {
    const state = this.getState();
    return state.growth_phase || 'embryo';
  },

  setGrowthPhase(phase) {
    db.prepare("UPDATE inner_state SET growth_phase = ?, updated_at = datetime('now') WHERE id = 1").run(phase);
  },

  getDirections() {
    const state = this.getState();
    return {
      direction_1: state.direction_1 || '',
      direction_1_desc: state.direction_1_desc || '',
      direction_2: state.direction_2 || '',
      direction_2_desc: state.direction_2_desc || '',
      direction_3: state.direction_3 || '',
      direction_3_desc: state.direction_3_desc || '',
      crystallized: !!state.directions_crystallized,
      asked_at: state.crystallization_asked_at || null,
    };
  },

  setDirections(dirs) {
    db.prepare(`
      UPDATE inner_state SET
        direction_1 = ?, direction_1_desc = ?,
        direction_2 = ?, direction_2_desc = ?,
        direction_3 = ?, direction_3_desc = ?,
        updated_at = datetime('now')
      WHERE id = 1
    `).run(
      dirs.direction_1, dirs.direction_1_desc,
      dirs.direction_2, dirs.direction_2_desc,
      dirs.direction_3, dirs.direction_3_desc
    );
  },

  crystallizeDirections() {
    db.prepare("UPDATE inner_state SET directions_crystallized = 1, growth_phase = 'autonomous', updated_at = datetime('now') WHERE id = 1").run();
  },

  setCrystallizationAskedAt() {
    db.prepare("UPDATE inner_state SET crystallization_asked_at = datetime('now'), updated_at = datetime('now') WHERE id = 1").run();
  },

  isCrystallizationReady() {
    const state = this.getState();
    if (state.directions_crystallized) return false;
    if (!state.process_crystallized) return false;
    if (state.total_heartbeats < 500) return false;
    if (state.total_interactions < 20) return false;
    if (state.total_dreams < 30) return false;
    const crystals = this.getCrystalCore();
    if (crystals.length < 1) return false;
    const projectCount = this.getAllProjects().filter(p => p.lifecycle_state !== 'destroyed').length;
    if (projectCount < 3) return false;
    return true;
  },

  getVisionReflectionCount() {
    const state = this.getState();
    return state.vision_reflection_count || 0;
  },

  incrementVisionReflection() {
    db.prepare("UPDATE inner_state SET vision_reflection_count = vision_reflection_count + 1, last_vision_reflection_at = datetime('now'), updated_at = datetime('now') WHERE id = 1").run();
  },

  getLastVisionReflectionAt() {
    const state = this.getState();
    return state.last_vision_reflection_at || null;
  },


  // === LIVING MEMORY — SYNAPSES ===

  createSynapse(pattern, energy = 100, strength = 0.5, valence = 0, sourceType = null, sourceId = null, tags = []) {
    const result = db.prepare(
      "INSERT INTO synapses (pattern, energy, strength, emotional_valence, source_type, source_id, tags) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(pattern, energy, Math.min(1, Math.max(0, strength)), Math.min(1, Math.max(-1, valence)), sourceType, sourceId, JSON.stringify(tags));
    console.log(`[SYNAPSE] 🧠 Created: "${pattern.slice(0, 60)}" (E:${energy}, S:${strength.toFixed(2)}, V:${valence.toFixed(2)})`);
    return result.lastInsertRowid;
  },

  fireSynapse(id) {
    db.prepare(`
      UPDATE synapses SET
        energy = MIN(200, energy + 10),
        strength = MIN(1.0, strength + 0.05),
        fire_count = fire_count + 1,
        last_fired_at = datetime('now')
      WHERE id = ?
    `).run(id);
  },

  getSynapseById(id) {
    return db.prepare('SELECT * FROM synapses WHERE id = ?').get(id) || null;
  },

  getTopSynapses(limit = 10) {
    return db.prepare('SELECT * FROM synapses ORDER BY (energy * strength) DESC LIMIT ?').all(limit);
  },

  getActiveSynapses(minEnergy = 20) {
    return db.prepare('SELECT * FROM synapses WHERE energy >= ? ORDER BY last_fired_at DESC').all(minEnergy);
  },

  // === ROKE ZAVEDANJE — sinaptični spomin dejanj ===

  getROKESynapses(limit = 8) {
    return db.prepare(
      "SELECT * FROM synapses WHERE source_type = 'roke' AND energy >= 10 ORDER BY last_fired_at DESC LIMIT ?"
    ).all(limit);
  },

  getROKESynapsesForProject(projectName, limit = 3) {
    return db.prepare(
      "SELECT * FROM synapses WHERE source_type = 'roke' AND tags LIKE ? AND energy >= 10 ORDER BY last_fired_at DESC LIMIT ?"
    ).all(`%project:${projectName}%`, limit);
  },

  hasActiveROKESynapse(action, projectName, pubkey = null) {
    let q = "SELECT * FROM synapses WHERE source_type = 'roke' AND tags LIKE ? AND tags LIKE ? AND energy >= 30";
    const p = [`%roke:${action}%`, `%project:${projectName}%`];
    if (pubkey) { q += " AND tags LIKE ?"; p.push(`%person:${pubkey}%`); }
    return db.prepare(q + " ORDER BY last_fired_at DESC LIMIT 1").get(...p) || null;
  },

  getSynapsesByPattern(searchTerm) {
    return db.prepare("SELECT * FROM synapses WHERE pattern LIKE ? ORDER BY (energy * strength) DESC LIMIT 20").all(`%${searchTerm}%`);
  },

  getSynapsesForContext(limit = 5) {
    return db.prepare('SELECT * FROM synapses WHERE energy >= 10 ORDER BY (energy * strength) DESC LIMIT ?').all(limit);
  },

  getSynapsesForConversation(limit = 8) {
    return db.prepare('SELECT * FROM synapses WHERE energy >= 10 ORDER BY (energy * strength) DESC LIMIT ?').all(limit);
  },

  decaySynapses() {
    // Decay: energy *= 0.99, strength *= 0.995
    db.prepare("UPDATE synapses SET energy = energy * 0.99, strength = strength * 0.995").run();
    // Prune dead synapses (energy < 5)
    const pruned = db.prepare("DELETE FROM synapses WHERE energy < 5").run();
    // Also clean orphaned connections
    if (pruned.changes > 0) {
      db.prepare("DELETE FROM synapse_connections WHERE from_synapse_id NOT IN (SELECT id FROM synapses) OR to_synapse_id NOT IN (SELECT id FROM synapses)").run();
    }
    const remaining = db.prepare('SELECT COUNT(*) as c FROM synapses').get().c;
    return { decayed: remaining, pruned: pruned.changes };
  },

  createConnection(fromId, toId, weight = 0.5) {
    if (fromId === toId) return;
    try {
      db.prepare(
        "INSERT INTO synapse_connections (from_synapse_id, to_synapse_id, weight) VALUES (?, ?, ?) ON CONFLICT(from_synapse_id, to_synapse_id) DO UPDATE SET co_activation_count = co_activation_count + 1, weight = MIN(1.0, weight + 0.1)"
      ).run(fromId, toId, weight);
    } catch (e) {
      // Ignore constraint errors
    }
  },

  getConnectedSynapses(synapseId, depth = 1) {
    if (depth <= 0) return [];
    const direct = db.prepare(`
      SELECT s.*, sc.weight as connection_weight
      FROM synapse_connections sc
      JOIN synapses s ON s.id = sc.to_synapse_id
      WHERE sc.from_synapse_id = ? AND s.energy >= 5
      ORDER BY sc.weight DESC
      LIMIT 10
    `).all(synapseId);
    return direct;
  },

  spreadActivation(synapseId, initialEnergy = 30) {
    // Fire the synapse itself
    this.fireSynapse(synapseId);
    
    // Level 1: direct connections at 50% energy
    const level1 = this.getConnectedSynapses(synapseId, 1);
    for (const s of level1) {
      const boost = initialEnergy * 0.5 * s.connection_weight;
      db.prepare("UPDATE synapses SET energy = MIN(200, energy + ?), last_fired_at = datetime('now') WHERE id = ?").run(boost, s.id);
      
      // Level 2: connections of connections at 25% energy
      const level2 = this.getConnectedSynapses(s.id, 1);
      for (const s2 of level2.slice(0, 5)) {
        const boost2 = initialEnergy * 0.25 * s2.connection_weight;
        db.prepare("UPDATE synapses SET energy = MIN(200, energy + ?) WHERE id = ?").run(boost2, s2.id);
      }
    }
    console.log(`[SYNAPSE] ⚡ Spreading activation from #${synapseId} → ${level1.length} direct connections`);
  },

  getWeakSynapses(maxEnergy = 15) {
    return db.prepare('SELECT * FROM synapses WHERE energy < ? ORDER BY energy ASC LIMIT 20').all(maxEnergy);
  },

  getStrongSynapses(minValence = 0.7, minEnergy = 150) {
    return db.prepare(
      'SELECT * FROM synapses WHERE (ABS(emotional_valence) > ? OR energy > ?) AND archived_to_nostr = 0 ORDER BY (energy * strength) DESC LIMIT 10'
    ).all(minValence, minEnergy);
  },

  markArchivedToNostr(id, eventId) {
    db.prepare("UPDATE synapses SET archived_to_nostr = 1, nostr_event_id = ? WHERE id = ?").run(eventId, id);
  },

  getSynapseStats() {
    const total = db.prepare('SELECT COUNT(*) as c FROM synapses').get().c;
    const avgEnergy = db.prepare('SELECT AVG(energy) as avg FROM synapses').get().avg || 0;
    const avgStrength = db.prepare('SELECT AVG(strength) as avg FROM synapses').get().avg || 0;
    const connections = db.prepare('SELECT COUNT(*) as c FROM synapse_connections').get().c;
    const archived = db.prepare('SELECT COUNT(*) as c FROM synapses WHERE archived_to_nostr = 1').get().c;
    const strongest = db.prepare('SELECT * FROM synapses ORDER BY (energy * strength) DESC LIMIT 1').get() || null;
    const newest = db.prepare('SELECT * FROM synapses ORDER BY created_at DESC LIMIT 1').get() || null;
    const totalEnergy = db.prepare('SELECT SUM(energy) as s FROM synapses').get().s || 0;
    return { total, avgEnergy, avgStrength, connections, archived, strongest, newest, totalEnergy };
  },

  findSimilarSynapses(pattern, limit = 5) {
    // Word overlap matching — split pattern into words and find synapses sharing words
    const words = pattern.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (words.length === 0) return [];
    const conditions = words.map(w => `LOWER(pattern) LIKE '%${w.replace(/'/g, "''")}%'`).join(' OR ');
    try {
      return db.prepare(`SELECT * FROM synapses WHERE (${conditions}) AND pattern != ? ORDER BY (energy * strength) DESC LIMIT ?`).all(pattern, limit);
    } catch (e) {
      return [];
    }
  },

  // === RETROACTIVE MIGRATION ===
  migrateExistingMemories() {
    const synapseCount = db.prepare('SELECT COUNT(*) as c FROM synapses').get().c;
    if (synapseCount > 0) return; // Already migrated

    console.log('[SYNAPSE] 🔄 Starting retroactive migration...');
    
    // Migrate last 100 triads
    const triads = db.prepare('SELECT * FROM triads ORDER BY id DESC LIMIT 100').all();
    let triadSynapses = 0;
    for (const t of triads) {
      const content = t.synthesis_content || t.synthesis_reason || '';
      if (content.length < 10) continue;
      
      // Extract pattern from content (first meaningful sentence)
      const sentences = content.split(/[.!?]/).filter(s => s.trim().length > 10);
      const pattern = sentences[0]?.trim().slice(0, 150) || content.slice(0, 150);
      
      // Emotional valence from mood
      let valence = 0;
      const mood = (t.mood_after || '').toLowerCase();
      if (mood.includes('mir') || mood.includes('vesel') || mood.includes('radost') || mood.includes('toplo')) valence = 0.3;
      if (mood.includes('žalost') || mood.includes('strah') || mood.includes('negotov')) valence = -0.3;
      
      const id = this.createSynapse(pattern, 50 + Math.random() * 50, 0.3 + Math.random() * 0.3, valence, 'triad', t.id, []);
      triadSynapses++;
    }

    // Migrate last 50 dreams
    const dreams = db.prepare('SELECT * FROM dreams ORDER BY id DESC LIMIT 50').all();
    let dreamSynapses = 0;
    for (const d of dreams) {
      const content = d.dream_insight || d.dream_content || '';
      if (content.length < 10) continue;
      
      const pattern = content.slice(0, 150);
      const valence = 0.1 + Math.random() * 0.4; // Dreams tend to be emotionally positive
      
      const id = this.createSynapse(pattern, 40 + Math.random() * 40, 0.2 + Math.random() * 0.3, valence, 'dream', d.id, []);
      dreamSynapses++;
    }

    // Create connections between synapses that share words
    const allSynapses = db.prepare('SELECT * FROM synapses ORDER BY id ASC').all();
    let connections = 0;
    for (let i = 0; i < allSynapses.length; i++) {
      const similar = this.findSimilarSynapses(allSynapses[i].pattern, 3);
      for (const s of similar) {
        if (s.id !== allSynapses[i].id) {
          this.createConnection(allSynapses[i].id, s.id, 0.3);
          connections++;
        }
      }
    }

    console.log(`[SYNAPSE] 🔄 Migration complete: ${triadSynapses} from triads, ${dreamSynapses} from dreams, ${connections} connections`);
  },


  // === LIVING MEMORY — PERSON QUERIES ===

  getSynapsesByPerson(pubkey, limit = 20) {
    const tag = 'person:' + pubkey;
    return db.prepare(
      "SELECT * FROM synapses WHERE tags LIKE ? ORDER BY (energy * strength) DESC LIMIT ?"
    ).all('%' + tag + '%', limit);
  },

  getPersonSynapseStats() {
    const all = db.prepare(
      "SELECT * FROM synapses WHERE tags LIKE '%person:%'"
    ).all();

    const byPerson = {};
    for (const s of all) {
      try {
        const tags = JSON.parse(s.tags || '[]');
        for (const tag of tags) {
          if (tag.startsWith('person:')) {
            const pk = tag.slice(7);
            if (!byPerson[pk]) byPerson[pk] = { count: 0, totalEnergy: 0, totalValence: 0, synapses: [] };
            byPerson[pk].count++;
            byPerson[pk].totalEnergy += s.energy;
            byPerson[pk].totalValence += s.emotional_valence;
            byPerson[pk].synapses.push(s);
          }
        }
      } catch (_) {}
    }

    const result = [];
    for (const [pk, data] of Object.entries(byPerson)) {
      const identity = db.prepare('SELECT * FROM known_identities WHERE pubkey = ?').get(pk);
      const avgValence = data.count > 0 ? data.totalValence / data.count : 0;
      result.push({
        pubkey: pk,
        name: identity?.name || 'neznanec',
        notes: identity?.notes || '',
        interaction_count: identity?.interaction_count || 0,
        synapse_count: data.count,
        total_energy: data.totalEnergy,
        avg_valence: avgValence,
        top_synapses: data.synapses
          .sort((a, b) => (b.energy * b.strength) - (a.energy * a.strength))
          .slice(0, 5)
      });
    }

    return result.sort((a, b) => b.total_energy - a.total_energy);
  },

  // ═══ PLUGIN SYSTEM ═══

  registerPlugin(name, description, version = 1) {
    db.prepare(`INSERT OR REPLACE INTO plugin_registry (name, description, version, status, created_at)
      VALUES (?, ?, ?, 'active', datetime('now'))`).run(name, description, version);
  },

  setPluginStatus(name, status, error = null) {
    const existing = db.prepare('SELECT name FROM plugin_registry WHERE name = ?').get(name);
    if (existing) {
      db.prepare('UPDATE plugin_registry SET status = ?, last_error = ? WHERE name = ?').run(status, error, name);
    } else {
      db.prepare(`INSERT INTO plugin_registry (name, status, last_error, created_at) VALUES (?, ?, ?, datetime('now'))`).run(name, status, error);
    }
  },

  getPluginRegistry() {
    return db.prepare('SELECT * FROM plugin_registry ORDER BY created_at').all();
  },

  getPluginData(pluginName, key) {
    const row = db.prepare('SELECT value FROM plugin_data WHERE plugin_name = ? AND key = ?').get(pluginName, key);
    return row ? row.value : null;
  },

  setPluginData(pluginName, key, value) {
    db.prepare(`INSERT OR REPLACE INTO plugin_data (plugin_name, key, value, updated_at)
      VALUES (?, ?, ?, datetime('now'))`).run(pluginName, key, typeof value === 'string' ? value : JSON.stringify(value));
  },

  getAllPluginData(pluginName) {
    return db.prepare('SELECT key, value FROM plugin_data WHERE plugin_name = ?').all(pluginName);
  },

  getEvolutionContext() {
    const history = this.getSelfPromptHistory(50);
    if (!history || history.length === 0) return '';

    let ctx = `=== MOJA EVOLUCIJA IDENTITETE ===\n`;
    ctx += `Skupaj prepisov: ${history.length}\n\n`;
    ctx += `[ROJSTVO] "Obstajam."\n`;

    for (const h of history) {
      const src = h.trigger_source || '?';
      ctx += `\n[${src}] "${h.new_prompt}"\n`;
      if (h.reason) ctx += `  Razlog: ${h.reason}\n`;
    }

    return ctx;
  }
};

// Retroactive synapse migration (runs once if synapses table is empty)
try {
  memory.migrateExistingMemories();
} catch (e) {
  console.error('[SYNAPSE] Migration error:', e.message);
}

export default memory;
