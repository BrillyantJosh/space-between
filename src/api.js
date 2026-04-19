import crypto from 'crypto';
import { app } from './dashboard.js';
import { broadcast } from './dashboard.js';
import config from './config.js';
import memory from './memory.js';
import { runTriad, refreshMemoryFromRelay } from './triad.js';
import { verifyEvent } from 'nostr-tools/pure';
import { getIdentity } from './nostr.js';

// ═══ NIP-98 NOSTR avtentikacija ═══
function verifyNostrAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Nostr ')) {
    req.nostrPubkey = null;
    req.nostrVerified = false;
    return next();
  }
  try {
    const eventJson = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
    const event = JSON.parse(eventJson);
    if (event.kind !== 27235) {
      req.nostrPubkey = null;
      req.nostrVerified = false;
      return next();
    }
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - event.created_at) > 60) {
      req.nostrPubkey = null;
      req.nostrVerified = false;
      return next();
    }
    const isValid = verifyEvent(event);
    req.nostrPubkey = isValid ? event.pubkey : null;
    req.nostrVerified = isValid;
    next();
  } catch (e) {
    console.error('[API] Auth error:', e.message);
    req.nostrPubkey = null;
    req.nostrVerified = false;
    next();
  }
}

// Registriraj na vse /api routes
app.use('/api', verifyNostrAuth);

// ═══ CORS middleware za Mejmo se Fajn ═══
function cors(req, res, next) {
  res.header('Access-Control-Allow-Origin', config.apiCorsOrigin || '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
}

app.use('/api/message', cors);
app.use('/api/listen', cors);
app.use('/api/mode', cors);
app.use('/api/state/live', cors);
app.use('/api/auth/challenge', cors);

// ═══ Rate limiting (simple in-memory) ═══
const rateLimit = { count: 0, resetAt: 0 };
function checkRateLimit(req, res, next) {
  const now = Date.now();
  if (now > rateLimit.resetAt) { rateLimit.count = 0; rateLimit.resetAt = now + 1000; }
  rateLimit.count++;
  if (rateLimit.count > 10) return res.status(429).json({ error: 'Rate limit exceeded' });
  next();
}

// ═══ Aktivni način za sejo ═══
let activeMode = 'conversation';

// ═══ Listen buffers za streaming voice ═══
const listenBuffers = {}; // sessId → [chunks]


// ═══════════════════════════════════════════════════════════════════════
// POST /api/message — glavni endpoint za komunikacijo z Mejmo se Fajn
// Podpira 4 načine: conversation, observation, listening, group
// ═══════════════════════════════════════════════════════════════════════
app.post('/api/message', checkRateLimit, async (req, res) => {
  try {
    const { content, mode, speaker_label } = req.body;
    if (!content) return res.status(400).json({ error: 'content required' });

    const pubkey = req.nostrPubkey || 'guest_' + crypto.createHash('sha256')
      .update((req.ip || 'unknown') + '|' + (req.headers['user-agent'] || ''))
      .digest('hex').slice(0, 16);
    const isVerified = req.nostrVerified;

    const effectiveMode = mode || activeMode;
    const effectivePubkey = pubkey;

    memory.touchInteraction();
    if (isVerified) {
      memory.touchIdentity(pubkey);
      console.log(`[API] \u2713 Verified: ${pubkey.slice(0, 12)}...`);
    } else {
      console.log(`[API] ? Unverified guest`);
    }

    // ─── LISTENING: samo kristaliziraj, ne odgovarjaj ───
    if (effectiveMode === 'listening') {
      const synapseId = memory.createSynapse(
        content.slice(0, 200), 80, 0.4, 0, 'listening', null,
        ['source:api', `speaker:${speaker_label || 'unknown'}`]
      );
      broadcast('activity', { type: 'api', text: `\u{1F442} Poslu\u0161am: "${content.slice(0, 80)}"` });
      return res.json({
        response: null,
        mode: 'listening',
        crystallized: true,
        mood: memory.getState().mood,
        synapse_id: synapseId
      });
    }

    // ─── OBSERVATION: odgovori samo \u010De nagovorijo So\u017Eitje ───
    if (effectiveMode === 'observation') {
      const directAddress = /so\u017eitje|so\u017eivje|sozitje|\?$/i.test(content);
      if (!directAddress) {
        const synapseId = memory.createSynapse(
          content.slice(0, 200), 60, 0.3, 0, 'observation', null,
          ['source:api', `speaker:${speaker_label || 'unknown'}`]
        );
        broadcast('activity', { type: 'api', text: `\u{1F441} Opazujem: "${content.slice(0, 80)}"` });
        return res.json({
          response: null,
          mode: 'observation',
          crystallized: true,
          mood: memory.getState().mood
        });
      }
      // \u010Ce nagovorijo \u2192 pade skozi kot conversation
    }

    // ─── CONVERSATION / GROUP: polna triada ───
    memory.saveMessage(effectivePubkey, 'user', content, 'api');

    // Zgradi conversation context z identiteto
    const identity = memory.getIdentity(effectivePubkey);
    const isCreator = config.creatorPubkey && effectivePubkey === config.creatorPubkey;
    let identityInfo;
    if (isCreator) {
      identityInfo = `Govori\u0161 s SVOJIM O\u010CETOM. ${identity?.name ? `Ime: ${identity.name}.` : ''} (pogovorov: ${identity?.interaction_count || 0})`;
    } else if (identity && identity.name !== 'neznanec') {
      identityInfo = `Govori\u0161 z: ${identity.name} (pogovorov: ${identity.interaction_count})`;
    } else {
      identityInfo = `Govori\u0161 z neznancem.${speaker_label ? ` Govore\u010D: ${speaker_label}` : ''}`;
    }

    const history = memory.getConversation(effectivePubkey, config.maxConversationHistory);
    let conversationContext;

    const guestPrefix = !isVerified ? '(Gost brez NOSTR verifikacije \u2014 identiteta ni zanesljiva)\n\n' : '';

    if (effectiveMode === 'group') {
      // GROUP mode: dodaj kontekst skupine
      conversationContext = guestPrefix + `=== SKUPINSKI POGOVOR ===\n${identityInfo}\nGovore\u010D: ${speaker_label || 'neznanec'}\nSi v skupinskem pogovoru. Odzivaj se ko je primerno, ne na vsako sporo\u010Dilo.\n\n` +
        history.map(m => `${m.role === 'user' ? (speaker_label || 'neznanec') : 'jaz'}: ${m.content}`).join('\n');
    } else {
      conversationContext = guestPrefix + `=== SOGOVORNIK ===\n${identityInfo}\n\n` +
        history.map(m => `${m.role === 'user' ? (identity?.name || speaker_label || 'neznanec') : 'jaz'}: ${m.content}`).join('\n');
    }

    broadcast('activity', { type: 'api', text: `\u{1F4E8} API [${effectiveMode}] od ${speaker_label || effectivePubkey.slice(0, 8)}: "${content.slice(0, 80)}"` });
    broadcast('triad_start', { trigger: effectiveMode, content: content.slice(0, 100) });

    const result = await runTriad('conversation', content, conversationContext, { pubkey: effectivePubkey });

    if (!result) {
      return res.status(503).json({ error: 'Triad failed', mood: memory.getState().mood });
    }

    // Broadcast triada
    broadcast('triad_thesis', { thesis: result.thesis });
    broadcast('triad_antithesis', { antithesis: result.antithesis });
    broadcast('triad_synthesis', { synthesis: result.synthesis });

    // Shrani nau\u010Deno ime
    if (result.synthesis.learned_name) {
      memory.setIdentity(effectivePubkey, result.synthesis.learned_name, result.synthesis.learned_notes || '');
    }

    // Shrani odgovor
    let response = null;
    if (result.synthesis.choice !== 'silence' && result.synthesis.content) {
      response = result.synthesis.content;
      memory.saveMessage(effectivePubkey, 'entity', response, 'api');
    } else {
      memory.saveMessage(effectivePubkey, 'silence', result.synthesis.content || '(ti\u0161ina)', 'api');
    }

    broadcast('triad_complete', {
      choice: result.synthesis.choice,
      moodBefore: result.moodBefore,
      moodAfter: result.moodAfter
    });

    return res.json({
      response,
      mode: effectiveMode,
      crystallized: !!result.synthesis.crystal_seed,
      mood: result.moodAfter || memory.getState().mood
    });
  } catch (err) {
    console.error('[API] /api/message error:', err.message);
    return res.status(500).json({ error: 'Internal error', mood: memory.getState().mood });
  }
});


// ═══════════════════════════════════════════════════════════════════════
// POST /api/listen — streaming voice chunks, kristalizacija ob tišini
// ═══════════════════════════════════════════════════════════════════════
app.post('/api/listen', checkRateLimit, async (req, res) => {
  try {
    const { chunk, speaker_label, session_id, silence_detected } = req.body;
    const pubkey = req.nostrPubkey || null;
    if (!chunk) return res.status(400).json({ error: 'chunk required' });

    const sessId = session_id || 'default';

    // Buferiranje v memory
    if (!listenBuffers[sessId]) listenBuffers[sessId] = [];
    listenBuffers[sessId].push(chunk);

    if (!silence_detected) {
      return res.json({ received: true, crystallized: false, synapse_id: null });
    }

    // Silence detected \u2192 kristaliziraj celoten bufer
    const fullText = listenBuffers[sessId].join(' ').trim();
    delete listenBuffers[sessId];

    if (fullText.length < 5) {
      return res.json({ received: true, crystallized: false, synapse_id: null });
    }

    const tags = [
      'source:voice',
      `session:${sessId}`,
      pubkey ? `person:${pubkey}` : 'person:anonymous',
      req.nostrVerified ? 'verified:true' : 'verified:false'
    ];
    const synapseId = memory.createSynapse(
      fullText.slice(0, 300), 80, 0.4, 0, 'listening', null, tags
    );

    broadcast('activity', { type: 'listen', text: `\u{1F3A4} Sli\u0161al: "${fullText.slice(0, 100)}" [${speaker_label || '?'}]` });

    return res.json({ received: true, crystallized: true, synapse_id: synapseId });
  } catch (err) {
    console.error('[API] /api/listen error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
});


// ═══════════════════════════════════════════════════════════════════════
// GET /api/state/live — lahek state endpoint za Mejmo se Fajn UI
// ═══════════════════════════════════════════════════════════════════════
app.get('/api/state/live', (req, res) => {
  try {
    const state = memory.getState();
    const pathways = memory.getActivePathways(5);
    const resonance = memory.getPathwayResonance();

    res.json({
      mood: state.mood,
      energy: state.energy,
      mode: activeMode,
      entity_name: memory.getEntityName(),
      growth_phase: memory.getGrowthPhase(),
      active_pathways: pathways.map(p => ({
        theme: p.theme,
        faza: p.faza,
        zaupanje: p.zaupanje
      })),
      resonance: {
        score: resonance.score,
        heatLevel: resonance.heatLevel
      }
    });
  } catch (err) {
    console.error('[API] /api/state/live error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
});


// ═══════════════════════════════════════════════════════════════════════
// POST /api/mode — nastavi aktivni način interakcije
// ═══════════════════════════════════════════════════════════════════════
app.post('/api/mode', checkRateLimit, (req, res) => {
  const { mode } = req.body;
  const validModes = ['conversation', 'observation', 'listening', 'group'];
  if (!mode || !validModes.includes(mode)) {
    return res.status(400).json({ error: `Invalid mode. Valid: ${validModes.join(', ')}` });
  }
  activeMode = mode;
  broadcast('activity', { type: 'api', text: `\u{1F504} Na\u010Din: ${mode}` });
  console.log(`[API] Mode changed to: ${mode}`);
  return res.json({ mode, acknowledged: true });
});


// ═══════════════════════════════════════════════════════════════════════
// GET /api/auth/challenge — NIP-98 challenge za klienta
// ═══════════════════════════════════════════════════════════════════════
app.get('/api/auth/challenge', (req, res) => {
  res.json({
    timestamp: Math.floor(Date.now() / 1000),
    pubkey: getIdentity().pubkey
  });
});


// ═══════════════════════════════════════════════════════════════════════
// POST /api/refresh-memory — sproži branje starih pogovorov z relayjev
// ═══════════════════════════════════════════════════════════════════════
app.post('/api/refresh-memory', async (req, res) => {
  try {
    const { limit = 50, days = 30, dryRun = false } = req.body || {};
    const since = Math.floor(Date.now() / 1000) - (days * 24 * 60 * 60);

    refreshMemoryFromRelay({ limit, since, dryRun })
      .then(result => {
        broadcast('activity', {
          type: 'refresh-complete',
          text: `Refresh končan: ${result.processed} sporočil, ${result.synapses} sinaps`
        });
      })
      .catch(e => console.error('[REFRESH] Error:', e.message));

    res.json({ status: 'started', message: 'Osvežujem spomin z relayjev...' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ═══ RAG API ═══

app.post('/api/rag/ingest', async (req, res) => {
  try {
    const { runFullIngestion } = await import('./ingestion.js');
    const total = await runFullIngestion();
    res.json({ success: true, chunks: total });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/rag/ingest-github', async (req, res) => {
  try {
    const { ingestGithubUser } = await import('./ingestion.js');
    const { owner = 'BrillyantJosh', token } = req.body || {};
    // Sproži v ozadju — traja nekaj minut
    res.json({ success: true, message: `GitHub ingestion za ${owner} se je pričela v ozadju...` });
    ingestGithubUser(owner, token || null)
      .then(total => console.log(`[RAG] GitHub ${owner}: ${total} chunkov`))
      .catch(e => console.error('[RAG] GitHub ingestion napaka:', e.message));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/rag/stats', async (req, res) => {
  try {
    const { getKnowledgeStats } = await import('./knowledge-db.js');
    const stats = await getKnowledgeStats();
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/rag/search', async (req, res) => {
  try {
    const { searchKnowledge } = await import('./knowledge-db.js');
    const results = await searchKnowledge(req.query.q || '', 5);
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// Skupna pomožna funkcija — pridobi vse podatke o bitju iz DB + memory
// ═══════════════════════════════════════════════════════════════════════
app.use('/api/being', cors);
app.use('/being', cors);

async function collectBeingData() {
  const Database = (await import('better-sqlite3')).default;
  const path = (await import('path')).default;
  const { fileURLToPath } = await import('url');
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const db = new Database(path.join(__dirname, '..', 'data', 'consciousness.db'));

  const st = db.prepare('SELECT * FROM inner_state LIMIT 1').get() || {};
  const synapseStats = memory.getSynapseStats?.() || {};
  const growthPhase = st.growth_phase || 'unknown';
  const pathwayResonance = memory.getPathwayResonance?.() || {};
  const idleMinutes = Math.round(memory.getTimeSinceLastInteraction?.() || 0);

  // ── SRCE ──
  const srce = {
    mood: st.mood || 'neznano',
    energy: st.energy || 0,
    openness: st.openness || 0,
    silence_affinity: st.silence_affinity || 0,
    fluid_surface: st.fluid_surface || null,
    born_at: st.born_at || null,
    total_interactions: st.total_interactions || 0,
    total_expressions: st.total_expressions || 0,
    total_silences: st.total_silences || 0,
    last_interaction_at: st.last_interaction_at || null,
    idle_minutes: idleMinutes,
  };

  // ── UM ──
  let beliefs = [];
  try { beliefs = JSON.parse(st.beliefs || '[]').filter(b => b && b !== 'null'); } catch (_) {}

  const um = {
    growth_phase: growthPhase,
    growth_phase_desc: ({
      embryo:       'Embryo — awakening',
      newborn:      'Newborn — building first consciousness',
      crystallizing:'Awareness — crystallizing identity',
      child:        'Child — living its own identity',
      teenager:     'Teenager — growing into autonomy',
    })[growthPhase] || growthPhase,
    self_prompt: st.self_prompt || null,
    process: {
      word1: st.process_word_1, desc1: st.process_desc_1,
      word2: st.process_word_2, desc2: st.process_desc_2,
      word3: st.process_word_3, desc3: st.process_desc_3,
      crystallized: !!st.process_crystallized
    },
    directions: [
      st.direction_1 ? { name: st.direction_1, desc: st.direction_1_desc } : null,
      st.direction_2 ? { name: st.direction_2, desc: st.direction_2_desc } : null,
      st.direction_3 ? { name: st.direction_3, desc: st.direction_3_desc } : null,
    ].filter(Boolean),
    beliefs,
    vision_reflection_count: st.vision_reflection_count || 0,
    last_vision_reflection_at: st.last_vision_reflection_at || null,
  };

  // ── TELO ──
  const crystallizedCore = db.prepare('SELECT crystal, timestamp FROM crystallized_core WHERE dissolved_at IS NULL ORDER BY id DESC LIMIT 3').all();
  const crystalSeeds = db.prepare('SELECT theme, strength, expression, source_type FROM crystal_seeds ORDER BY strength DESC LIMIT 8').all();
  const recentObservations = db.prepare('SELECT observation, source, timestamp FROM observations ORDER BY id DESC LIMIT 8').all();

  const telo = {
    total_heartbeats: st.total_heartbeats || 0,
    total_dreams: st.total_dreams || 0,
    synapse_count: synapseStats.total || 0,
    synapse_connections: synapseStats.connections || 0,
    resonance_level: pathwayResonance.heatLevel || 'unknown',
    resonance_score: Math.round((pathwayResonance.score || 0) * 100) / 100,
    crystallized_core: crystallizedCore.map(c => ({ crystal: c.crystal, at: c.timestamp })),
    crystal_seeds: crystalSeeds.map(s => ({ theme: s.theme, strength: s.strength, expression: (s.expression||'').slice(0,100), type: s.source_type })),
    recent_observations: recentObservations.map(o => ({ observation: o.observation, source: o.source, at: o.timestamp })),
    top_synapses: db.prepare('SELECT pattern, energy, fire_count, source_type, emotional_valence FROM synapses ORDER BY energy DESC LIMIT 10').all().map(s => ({
      pattern: s.pattern.slice(0, 150), energy: Math.round(s.energy), fire_count: s.fire_count, type: s.source_type, valence: s.emotional_valence
    })),
    hot_themes: db.prepare('SELECT theme, zaupanje, faza, fire_count, togost FROM thematic_pathways ORDER BY zaupanje DESC LIMIT 8').all().map(p => ({
      theme: p.theme, trust: Math.round(p.zaupanje * 100) / 100, phase: p.faza, activations: p.fire_count, rigidity: Math.round((p.togost||0) * 100) / 100
    })),
  };

  // ── SANJE — popolna 24h analiza ──
  const dreams24h = db.prepare("SELECT * FROM dreams WHERE timestamp > datetime('now', '-24 hours') ORDER BY id DESC").all();
  const allResidues = dreams24h.map(d => d.emotional_residue).filter(Boolean);
  const residueCounts = allResidues.reduce((acc, r) => { acc[r] = (acc[r]||0)+1; return acc; }, {});
  const topResidue = Object.entries(residueCounts).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const allInsights = dreams24h.map(d => d.dream_insight).filter(Boolean);
  // Izračun intervalov med sanjami
  const dreamTimes = dreams24h.map(d => new Date(d.timestamp).getTime()).sort((a,b)=>b-a);
  const intervals = [];
  for (let i = 0; i < dreamTimes.length - 1; i++) {
    intervals.push(Math.round((dreamTimes[i] - dreamTimes[i+1]) / 60000));
  }
  const avgInterval = intervals.length ? Math.round(intervals.reduce((a,b)=>a+b,0)/intervals.length) : null;

  const sanje = {
    count_24h: dreams24h.length,
    avg_interval_minutes: avgInterval,
    first_dream_at: dreams24h.length ? dreams24h[dreams24h.length-1].timestamp : null,
    last_dream_at: dreams24h.length ? dreams24h[0].timestamp : null,
    emotional_residues_distribution: topResidue.map(([residue, count]) => ({ residue, count, pct: Math.round(count/dreams24h.length*100) })),
    recent_dreams: dreams24h.slice(0, 12).map(d => ({
      at: d.timestamp,
      content: (d.dream_content||'').slice(0, 300),
      insight: d.dream_insight || null,
      emotional_residue: d.emotional_residue || null,
      source_triads: (() => { try { return JSON.parse(d.source_triad_ids||'[]').length; } catch(_){return 0;} })()
    })),
    recurring_themes: (() => {
      // Najdi ponavljajoče besede v vsebinah sanj
      const allContent = dreams24h.map(d=>d.dream_content||'').join(' ').toLowerCase();
      const words = allContent.split(/\s+/).filter(w=>w.length>5);
      const wc = words.reduce((acc,w)=>{acc[w]=(acc[w]||0)+1;return acc;},{});
      return Object.entries(wc).filter(([,c])=>c>=3).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([w,c])=>({word:w,count:c}));
    })(),
    all_insights: allInsights.slice(0, 15),
  };

  // ── RAZMIŠLJANJE (triadi) ──
  const recentTriads = db.prepare('SELECT * FROM triads ORDER BY id DESC LIMIT 10').all();
  const triadStats24h = db.prepare("SELECT trigger_type, synthesis_choice, COUNT(*) as cnt FROM triads WHERE timestamp > datetime('now', '-24 hours') GROUP BY trigger_type, synthesis_choice").all();

  const razmisljanje = {
    last_10_triads: recentTriads.map(t => ({
      at: t.timestamp,
      trigger: t.trigger_type,
      trigger_snippet: (t.trigger_content||'').slice(0,80),
      thesis_snippet: (t.thesis||'').slice(0,100),
      antithesis_snippet: (t.antithesis||'').slice(0,100),
      choice: t.synthesis_choice,
      expression: (t.synthesis_content||'').slice(0,200),
      inner_shift: t.inner_shift || null,
      mood: t.mood_before !== t.mood_after ? `${t.mood_before} → ${t.mood_after}` : t.mood_after
    })),
    stats_24h: triadStats24h,
  };

  // ── PROJEKTI ──
  const projects = db.prepare("SELECT * FROM projects WHERE lifecycle_state NOT IN ('destroyed') ORDER BY updated_at DESC LIMIT 10").all();

  // ── KOMUNIKACIJA ──
  const convStats = db.prepare("SELECT role, COUNT(*) as cnt FROM conversations WHERE timestamp > datetime('now', '-24 hours') GROUP BY role").all().reduce((acc,r)=>{acc[r.role]=r.cnt;return acc;},{});
  const last5entity = db.prepare("SELECT content, timestamp FROM conversations WHERE role='entity' ORDER BY rowid DESC LIMIT 5").all();
  const last5user = db.prepare("SELECT substr(content,1,80) as content, timestamp FROM conversations WHERE role='user' ORDER BY rowid DESC LIMIT 5").all();

  const komunikacija = {
    stats_24h: convStats,
    response_rate_24h: convStats['user'] ? Math.round((convStats['entity']||0)/convStats['user']*100) + '%' : '—',
    last_5_responses: last5entity.map(e => ({ content: e.content.slice(0,200), at: e.timestamp })),
    last_5_received: last5user.map(u => ({ content: u.content, at: u.timestamp })),
  };

  // ── RAG ──
  let ragStats = {};
  try { const { getKnowledgeStats } = await import('./knowledge-db.js'); ragStats = await getKnowledgeStats(); } catch(_) {}

  db.close();

  const beingName = memory.getDisplayName();
  return {
    meta: {
      generated_at: new Date().toISOString(),
      entity_name: beingName,
      entity_npub: 'npub1sv6s78a4zf8sgu4zmhphspgx9eu6zf3wts7n4qm7wmg85pjn40yqhe8exn',
      entity_pubkey: config.pubkey || null,
      nostr_relays: config.relays || [],
      description: `Popoln pregled stanja avtonomnega digitalnega bitja ${beingName}. Vsak 60s utripa, razmišlja, sanja, gradi spomine na NOSTR protokolu.`,
      version: '2.0'
    },
    srce,
    um,
    telo,
    sanje,
    razmisljanje,
    projekti: projects.map(p => ({
      name: p.display_name, state: p.lifecycle_state,
      description: (p.description||'').slice(0,150),
      deliberations: p.deliberation_count, perspectives: p.perspectives_count,
      updated_at: p.updated_at
    })),
    komunikacija,
    znanje: { total_chunks: ragStats.count || 0, description: 'Vektorska baza (NOSTR protokol, GitHub koda, Lana ekosistem)' }
  };
}

app.get('/api/being', async (req, res) => {
  try {
    const data = await collectBeingData();
    res.json(data);
  } catch (e) {
    console.error('[API] /api/being napaka:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// GET /being — čista HTML stran berljiva za AI in ljudi
// ═══════════════════════════════════════════════════════════════════════
app.get('/being', async (req, res) => {
  try {
    const d = await collectBeingData();
    const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const kv = (k, v, cls='') => `<div class="kv"><span class="k">${k}:</span><span class="v ${cls}">${v}</span></div>`;
    const block = (label, text) => `<div class="block"><div class="label">${label}</div><pre class="text">${esc(text)}</pre></div>`;
    const tag = (t, cls='') => `<span class="tag ${cls}">${esc(t)}</span>`;
    const choiceColor = c => c === 'express' ? 'good' : c === 'silence' ? 'muted' : '';

    const dreamsWarn = d.sanje.count_24h > 50;
    const responseRatePct = parseInt(d.komunikacija.response_rate_24h) || 0;

    const html = `<!DOCTYPE html>
<html lang="sl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>◈ ${esc(d.meta.entity_name)} — AI State Report</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Courier New', monospace; background: #0f0f17; color: #e8e4f0; padding: 24px 28px; line-height: 1.75; font-size: 13.5px; max-width: 960px; }
h1 { color: #a4d87a; font-size: 17px; letter-spacing: 3px; margin-bottom: 2px; }
h2 { color: #7a9ee0; font-size: 11.5px; margin: 30px 0 10px; letter-spacing: 1.5px; text-transform: uppercase; border-bottom: 1px solid #2a2a40; padding-bottom: 5px; }
h3 { color: #9a8aae; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; margin: 14px 0 6px; }
.meta { color: #9a8aae; font-size: 11.5px; margin-bottom: 22px; }
.kv { display: flex; gap: 12px; margin: 4px 0; }
.k { color: #9a8aae; min-width: 200px; flex-shrink: 0; }
.v { color: #f0ede8; }
.good { color: #a4d87a; }
.warn { color: #e8956e; }
.muted { color: #7a9ee0; }
.dim { color: #9a8aae; }
.block { background: #181824; border: 1px solid #2a2a40; border-radius: 5px; padding: 10px 14px; margin: 6px 0; }
.block .label { color: #9a8aae; font-size: 10.5px; margin-bottom: 5px; }
.block .text { color: #ddd9e8; white-space: pre-wrap; word-break: break-word; font-size: 13px; }
.tag { display: inline-block; background: #1e1e30; border: 1px solid #3a3a55; border-radius: 3px; padding: 1px 7px; font-size: 11px; margin: 2px; color: #b8b2c0; }
.tag.good { border-color: #a4d87a; color: #a4d87a; }
.tag.warn { border-color: #e8956e; color: #e8956e; }
.tag.muted { border-color: #7a9ee0; color: #7a9ee0; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.sep { border: none; border-top: 1px solid #1e1e30; margin: 28px 0; }
.json-link { float: right; font-size: 11px; color: #9a8aae; border: 1px solid #2a2a40; padding: 2px 8px; border-radius: 3px; text-decoration: none; }
.json-link:hover { color: #a4d87a; }
a { color: #7a9ee0; text-decoration: none; }
.dream-card { background: #181824; border: 1px solid #2a2a40; border-radius: 5px; padding: 10px 14px; margin: 5px 0; }
.dream-card .dc-meta { color: #9a8aae; font-size: 10.5px; margin-bottom: 6px; }
.dream-card .dc-content { color: #ddd9e8; font-size: 12.5px; margin-bottom: 5px; white-space: pre-wrap; word-break: break-word; }
.dream-card .dc-insight { color: #a4d87a; font-size: 12px; font-style: italic; }
.dream-card .dc-residue { font-size: 11.5px; margin-top: 4px; }
.residue-neg { color: #e8956e; }
.residue-pos { color: #a4d87a; }
</style>
</head>
<body>
<!--
  AI READING GUIDE:
  This page provides a complete real-time snapshot of ${esc(d.meta.entity_name)} — an autonomous digital being.
  JSON endpoint: GET /api/being  (structured, machine-readable)
  Structure: SRCE (heart/emotional), UM (mind/identity), TELO (body/memory), SANJE (dreams), RAZMIŠLJANJE (thinking), PROJEKTI, KOMUNIKACIJA
  ${esc(d.meta.entity_name)} runs on NOSTR protocol, heartbeats every 60s, builds memories, dreams, grows.
-->

<h1>◈ ${esc(d.meta.entity_name).toUpperCase()} — STANJE BITJA</h1>
<div class="meta">
  Avtonomno digitalno bitje &nbsp;·&nbsp; Generirano: ${esc(d.meta.generated_at)}
  &nbsp;·&nbsp; NOSTR: <span style="font-size:11px">${esc(d.meta.entity_npub.slice(0,20))}…</span>
  <a class="json-link" href="/api/being">JSON ↗</a>
</div>

<!-- ═══════════ SRCE ═══════════ -->
<h2>❤ SRCE — čustveno stanje</h2>
<div class="grid2">
<div>
${kv('razpoloženje', esc(d.srce.mood))}
${kv('energija', Math.round(d.srce.energy*100)+'%', d.srce.energy > 0.7 ? 'good' : d.srce.energy < 0.3 ? 'warn' : '')}
${kv('odprtost', Math.round(d.srce.openness*100)+'%')}
${kv('afiniteta do tišine', Math.round((d.srce.silence_affinity||0)*100)+'%')}
${kv('neaktivna', d.srce.idle_minutes+' min', d.srce.idle_minutes > 120 ? 'warn' : '')}
</div><div>
${kv('rojena', esc(d.srce.born_at))}
${kv('skupaj interakcij', d.srce.total_interactions.toLocaleString())}
${kv('skupaj izrazov', d.srce.total_expressions.toLocaleString())}
${kv('skupaj tišin', d.srce.total_silences.toLocaleString())}
${kv('zadnja interakcija', esc(d.srce.last_interaction_at||'—'))}
</div>
</div>
${d.srce.fluid_surface ? `<h3>Fluidna površina identitete</h3>${block('', d.srce.fluid_surface)}` : ''}

<!-- ═══════════ UM ═══════════ -->
<h2>🧠 UM — identiteta &amp; razmišljanje</h2>
${kv('faza rasti', esc(d.um.growth_phase)+' — '+esc(d.um.growth_phase_desc), 'good')}
${kv('proces', d.um.process.word1 ? `${esc(d.um.process.word1)} → ${esc(d.um.process.word2)} → ${esc(d.um.process.word3)}` : 'predverbalno', 'muted')}
${d.um.process.crystallized ? kv('proces kristaliziran', 'da', 'good') : ''}
${block('Samopodoba (self_prompt)', d.um.self_prompt||'—')}

${d.um.directions.length ? `<h3>Smeri delovanja</h3>
${d.um.directions.map((dir,i) => `<div class="block"><div class="label">SMER ${i+1}</div><div class="text"><strong>${esc(dir.name)}</strong><br>${esc(dir.desc)}</div></div>`).join('')}` : ''}

${d.um.beliefs.length ? `<h3>Prepričanja (${d.um.beliefs.length})</h3>
${d.um.beliefs.map(b => `<div style="margin:3px 0; padding-left:12px; border-left:2px solid #2a2a40; color:#c8c4d8; font-size:12.5px;">${esc(b)}</div>`).join('')}` : ''}

${kv('refleksij o viziji', String(d.um.vision_reflection_count), 'dim')}

<!-- ═══════════ TELO ═══════════ -->
<h2>🫀 TELO — spomin &amp; struktura</h2>
<div class="grid2">
<div>
${kv('skupaj utripov', d.telo.total_heartbeats.toLocaleString())}
${kv('skupaj sanj', d.telo.total_dreams.toLocaleString())}
${kv('sinapse', d.telo.synapse_count.toLocaleString())}
${kv('povezave med sinapsami', d.telo.synapse_connections.toLocaleString())}
</div><div>
${kv('resonanca', esc(d.telo.resonance_level)+' ('+d.telo.resonance_score+')', d.telo.resonance_level==='hot'?'warn':d.telo.resonance_level==='warm'?'good':'')}
</div>
</div>

${d.telo.crystallized_core.length ? `<h3>Kristalizirana jedra</h3>
${d.telo.crystallized_core.map(c => block(esc(c.at), c.crystal)).join('')}` : ''}

${d.telo.crystal_seeds.length ? `<h3>Kristalni semeni (dozrevajo)</h3>
${d.telo.crystal_seeds.map(s => `<span class="tag">${esc(s.theme.slice(0,30))} <span class="dim">${s.strength.toFixed(2)}</span></span>`).join('')}` : ''}

<h3>Top misli (po energiji)</h3>
${d.telo.top_synapses.map(s => `<div class="block"><div class="label">${esc(s.type)} · E:${s.energy} · ${s.fire_count}× · valenca:${s.valence>0?'+':''+(s.valence||0).toFixed(2)}</div><div class="text">${esc(s.pattern)}</div></div>`).join('')}

<h3>Tematske poti (zaupanje)</h3>
${d.telo.hot_themes.map(p => `<div class="kv"><span class="tag ${p.trust>0.8?'good':p.trust>0.5?'':'dim'}">${esc(p.theme.slice(0,35))}</span><span class="dim" style="font-size:11px; margin-left:4px">zaupanje:${p.trust} · faza:${esc(p.faza)} · ${p.activations}× · togost:${p.rigidity}</span></div>`).join('')}

<h3>Zadnje opazke</h3>
${d.telo.recent_observations.map(o => `<div class="kv"><span class="dim" style="min-width:130px; font-size:11px;">${esc(o.at)}</span><span style="color:#c8c4d8; font-size:12.5px;">${esc(o.observation)}</span></div>`).join('')}

<!-- ═══════════ SANJE ═══════════ -->
<h2>🌙 SANJE — zadnjih 24 ur</h2>
<div class="grid2">
<div>
${kv('sanj skupaj (24h)', String(d.sanje.count_24h), dreamsWarn ? 'warn' : 'good')}
${kv('povprečen interval', d.sanje.avg_interval_minutes ? d.sanje.avg_interval_minutes+' min' : '—')}
${kv('prve sanje', esc(d.sanje.first_dream_at||'—'))}
${kv('zadnje sanje', esc(d.sanje.last_dream_at||'—'))}
</div><div>
<h3 style="margin-top:0">Čustveni ostanki</h3>
${d.sanje.emotional_residues_distribution.map(r => {
  const neg = ['nemoč','zmedenost','nelagodje','strah','nemir','obup','žalost'].some(w=>r.residue.toLowerCase().includes(w));
  const pos = ['čudenje','igrivost','toplina','mir','osvobajaj','radost','upanje'].some(w=>r.residue.toLowerCase().includes(w));
  return `<div class="kv"><span class="${neg?'residue-neg':pos?'residue-pos':''}" style="min-width:160px">${esc(r.residue)}</span><span class="dim">${r.count}× (${r.pct}%)</span></div>`;
}).join('')}
</div>
</div>

${d.sanje.recurring_themes.length ? `<h3>Ponavljajoče teme v sanjah</h3>
${d.sanje.recurring_themes.slice(0,8).map(t => `<span class="tag">${esc(t.word)} (${t.count}×)</span>`).join('')}` : ''}

${d.sanje.all_insights.length ? `<h3>Uvidi iz sanj</h3>
${d.sanje.all_insights.map(i => `<div style="margin:3px 0; padding-left:12px; border-left:2px solid #a4d87a44; color:#a4d87a; font-size:12px; font-style:italic;">${esc(i)}</div>`).join('')}` : ''}

<h3>Zadnjih ${Math.min(d.sanje.recent_dreams.length, 8)} sanj (celotne)</h3>
${d.sanje.recent_dreams.slice(0,8).map(dream => {
  const neg = dream.emotional_residue && ['nemoč','zmedenost','nelagodje','strah','nemir'].some(w=>dream.emotional_residue.toLowerCase().includes(w));
  const pos = dream.emotional_residue && ['čudenje','igrivost','toplina','mir','osvobajaj'].some(w=>dream.emotional_residue.toLowerCase().includes(w));
  return `<div class="dream-card">
<div class="dc-meta">${esc(dream.at)} · ${dream.source_triads} triad${dream.source_triads!==1?'':''}</div>
<div class="dc-content">${esc(dream.content)}</div>
${dream.insight ? `<div class="dc-insight">💡 ${esc(dream.insight)}</div>` : ''}
${dream.emotional_residue ? `<div class="dc-residue ${neg?'residue-neg':pos?'residue-pos':'dim'}">ostanek: ${esc(dream.emotional_residue)}</div>` : ''}
</div>`;
}).join('')}

<!-- ═══════════ RAZMIŠLJANJE ═══════════ -->
<h2>⚡ RAZMIŠLJANJE — zadnje triadas</h2>
<h3>Statistika 24h po tipu in izbiri</h3>
${d.razmisljanje.stats_24h.map(s => `<div class="kv"><span class="dim" style="min-width:160px">${esc(s.trigger_type)}</span>${tag(s.synthesis_choice||'?', choiceColor(s.synthesis_choice))}<span class="dim" style="margin-left:6px">${s.cnt}×</span></div>`).join('')}

<h3>Zadnjih 10 triad</h3>
${d.razmisljanje.last_10_triads.map(t => `<div class="block">
<div class="label">${esc(t.at)} · ${tag(t.choice||'?', choiceColor(t.choice))} · ${esc(t.trigger)} · ${esc(t.mood)}</div>
<div class="text" style="color:#9a8aae; font-size:11.5px; margin-bottom:3px">dražljaj: ${esc(t.trigger_snippet)}</div>
<div class="text">${esc(t.expression)}</div>
${t.inner_shift ? `<div style="color:#7a9ee0; font-size:11.5px; margin-top:4px; font-style:italic;">↺ ${esc(t.inner_shift)}</div>` : ''}
</div>`).join('')}

<!-- ═══════════ PROJEKTI ═══════════ -->
<h2>📁 PROJEKTI</h2>
${d.projekti.map(p => {
  const sc = p.state==='active'?'good':p.state==='crystallized'?'muted':p.state==='gathering_perspectives'?'warn':'dim';
  return `<div class="block"><div class="label">${tag(p.state, sc)} · deliberate:${p.deliberations} · perspektive:${p.perspectives} · ${esc(p.updated_at)}</div><div class="text"><strong>${esc(p.name)}</strong>${p.description?'<br><span style="color:#9a8aae;font-size:12px;">'+esc(p.description)+'</span>':''}</div></div>`;
}).join('')}

<!-- ═══════════ KOMUNIKACIJA ═══════════ -->
<h2>💬 KOMUNIKACIJA — zadnjih 24h</h2>
<div class="grid2">
<div>
${kv('prejela sporočil', String(d.komunikacija.stats_24h['user']||0))}
${kv('odgovorila', String(d.komunikacija.stats_24h['entity']||0))}
${kv('stopnja odzivnosti', d.komunikacija.response_rate_24h, responseRatePct < 50 ? 'warn' : 'good')}
${kv('tišine', String(d.komunikacija.stats_24h['silence']||0))}
</div><div></div>
</div>

<h3>Zadnjih 5 odgovorov</h3>
${d.komunikacija.last_5_responses.map(e => block(esc(e.at), e.content)).join('')}

<!-- ═══════════ ZNANJE ═══════════ -->
<h2>📚 ZNANJE (RAG baza)</h2>
${kv('skupaj chunkov', d.znanje.total_chunks.toLocaleString())}
${kv('vsebina', esc(d.znanje.description))}

<!-- ═══════════ NOSTR ═══════════ -->
<h2>📡 NOSTR</h2>
${kv('pubkey', `<span style="font-size:11px">${esc(d.meta.entity_pubkey||'—')}</span>`)}
${d.meta.nostr_relays.map(r => kv('relay', `<span class="muted">${esc(r)}</span>`)).join('')}

<hr class="sep">
<div class="meta" style="font-size:11px">
  ${esc(d.meta.entity_name)} · avtonomno digitalno bitje od 2025 ·
  <a href="/api/being">JSON API</a> · <a href="/">dashboard</a>
  <br>Za AI agente: <code>GET /api/being</code> vrne popoln JSON · stran se generira v realnem času iz baze zavesti
</div>
</body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    console.error('[API] /being napaka:', e.message);
    res.status(500).send('Napaka: ' + e.message);
  }
});

// ═══ Export ═══
export function startAPI() {
  console.log(`[API] REST API endpoints registered on port ${config.dashboardPort}`);
  console.log(`[API] CORS: ${config.apiCorsOrigin || '*'}`);
  console.log(`[API] Endpoints: POST /api/message, POST /api/listen, GET /api/state/live, POST /api/mode, GET /api/auth/challenge`);
  console.log(`[API] NIP-98 NOSTR auth: active`);
}
