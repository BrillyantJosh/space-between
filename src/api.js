import { app } from './dashboard.js';
import { broadcast } from './dashboard.js';
import config from './config.js';
import memory from './memory.js';
import { runTriad } from './triad.js';
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

    const pubkey = req.nostrPubkey || 'guest_' + Date.now();
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
    memory.saveMessage(effectivePubkey, 'user', content);

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
      memory.saveMessage(effectivePubkey, 'entity', response);
    } else {
      memory.saveMessage(effectivePubkey, 'silence', result.synthesis.content || '(ti\u0161ina)');
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


// ═══ Export ═══
export function startAPI() {
  console.log(`[API] REST API endpoints registered on port ${config.dashboardPort}`);
  console.log(`[API] CORS: ${config.apiCorsOrigin || '*'}`);
  console.log(`[API] Endpoints: POST /api/message, POST /api/listen, GET /api/state/live, POST /api/mode, GET /api/auth/challenge`);
  console.log(`[API] NIP-98 NOSTR auth: active`);
}
