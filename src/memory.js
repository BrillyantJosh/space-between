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

// Migrate existing active projects to lifecycle_state='active'
try {
  db.prepare("UPDATE projects SET lifecycle_state = 'active', direction = 'external' WHERE status = 'active' AND lifecycle_state = 'seed'").run();
  db.prepare("UPDATE projects SET lifecycle_state = 'destroyed' WHERE status = 'destroyed' AND lifecycle_state = 'seed'").run();
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
    const allowed = ['display_name', 'description', 'status', 'entry_file', 'file_count', 'notes', 'version', 'destruction_reason', 'destroyed_at', 'last_reflected_at', 'direction', 'lifecycle_state', 'deliberation_count', 'build_step', 'total_build_steps', 'last_shared_at', 'feedback_summary', 'plan_json'];
    const keys = Object.keys(updates).filter(k => allowed.includes(k));
    if (keys.length === 0) return;
    const sets = keys.map(k => `${k} = ?`).join(', ');
    const vals = keys.map(k => updates[k]);
    db.prepare(`UPDATE projects SET ${sets}, updated_at = datetime('now') WHERE name = ?`).run(...vals, name);
  },

  getProject(name) {
    return db.prepare('SELECT * FROM projects WHERE name = ?').get(name) || null;
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
    const last = db.prepare('SELECT * FROM projects ORDER BY created_at DESC LIMIT 1').get() || null;
    return { total, active, destroyed, lastCreated: last };
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
    return db.prepare("SELECT * FROM projects WHERE lifecycle_state IN ('seed', 'deliberating') ORDER BY updated_at ASC").all();
  },

  getProjectsNeedingAttention() {
    // Priority order: deliberating ready to build, seeds needing deliberation, active+unshared, active+feedback
    const readyToBuild = db.prepare("SELECT *, 'build' as needed_action FROM projects WHERE lifecycle_state = 'deliberating' AND deliberation_count >= 2 LIMIT 1").all();
    const seeds = db.prepare("SELECT *, 'deliberate' as needed_action FROM projects WHERE lifecycle_state = 'seed' LIMIT 1").all();
    const unshared = db.prepare("SELECT *, 'share' as needed_action FROM projects WHERE lifecycle_state = 'active' AND last_shared_at IS NULL LIMIT 1").all();
    const withFeedback = db.prepare("SELECT *, 'evolve' as needed_action FROM projects WHERE lifecycle_state = 'active' AND feedback_summary != '' AND feedback_summary IS NOT NULL LIMIT 1").all();
    return [...readyToBuild, ...seeds, ...unshared, ...withFeedback];
  },

  setProjectFeedback(name, summary) {
    db.prepare("UPDATE projects SET feedback_summary = ?, updated_at = datetime('now') WHERE name = ?").run(summary, name);
  },

  markProjectShared(name) {
    db.prepare("UPDATE projects SET last_shared_at = datetime('now'), updated_at = datetime('now') WHERE name = ?").run(name);
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

export default memory;
