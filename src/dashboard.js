import express from 'express';
import config from './config.js';
import memory from './memory.js';
import { runTriad } from './triad.js';
import { getIdentity, getRelayStatus } from './nostr.js';

const app = express();
app.use(express.json());

// SSE clients
const sseClients = new Set();

export function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(msg); } catch (_) { sseClients.delete(client); }
  }
  // Persist activity events to DB
  if (event === 'activity' && data.type && data.text) {
    try { memory.saveActivity(data.type, data.text); } catch (_) {}
  }
}

// SSE endpoint
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  res.write('event: connected\ndata: {}\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// API: state
app.get('/api/state', (req, res) => {
  const state = memory.getState();
  const triads = memory.getRecentTriads(20);
  const dreams = memory.getRecentDreams(5);
  const observations = memory.getRecentObservations(15);
  const { pubkey, npub } = getIdentity();
  const relays = getRelayStatus();
  const selfPrompt = memory.getSelfPrompt();
  const selfPromptHistory = memory.getSelfPromptHistory(30);
  const activities = memory.getRecentActivities(150);
  const pendingSelfPrompt = state.pending_self_prompt || null;
  const crystalCore = memory.getCrystalCore();
  const crystalSeeds = memory.getCrystalSeeds();
  const fluidSurface = memory.getFluidSurface();
  res.json({ state, triads, dreams, observations, relays, pubkey, npub, selfPrompt, selfPromptHistory, activities, pendingSelfPrompt, crystalCore, crystalSeeds, fluidSurface });
});

// API: chat
app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    if (!message) return res.status(400).json({ error: 'No message' });

    const chatPubkey = sessionId || 'dashboard';
    memory.saveMessage(chatPubkey, 'user', message);
    memory.touchInteraction();
    memory.touchIdentity(chatPubkey);

    // Build conversation context with identity
    const identity = memory.getIdentity(chatPubkey);
    const identityInfo = identity && identity.name !== 'neznanec'
      ? `Govoriš z: ${identity.name} (pogovorov: ${identity.interaction_count}${identity.notes ? ', opombe: ' + identity.notes : ''})`
      : `Govoriš z neznancem (ID: ${chatPubkey.slice(0, 8)}). Še ne veš kdo je.`;
    const history = memory.getConversation(chatPubkey, config.maxConversationHistory);
    const conversationContext = `=== SOGOVORNIK ===\n${identityInfo}\n\n` + history.map(m => {
      const who = m.role === 'user' ? (identity?.name || 'neznanec') : 'jaz';
      return `${who}: ${m.content}`;
    }).join('\n');

    broadcast('triad_start', { trigger: 'conversation', content: message });

    const result = await runTriad('conversation', message, conversationContext);

    if (!result) {
      return res.json({ response: '...', choice: 'error', triad: null });
    }

    broadcast('triad_thesis', { thesis: result.thesis });
    broadcast('triad_antithesis', { antithesis: result.antithesis });
    broadcast('triad_synthesis', { synthesis: result.synthesis });

    // Save entity response
    if (result.synthesis.choice !== 'silence') {
      memory.saveMessage(chatPubkey, 'entity', result.synthesis.content);
    } else {
      memory.saveMessage(chatPubkey, 'silence', result.synthesis.content || '(tišina)');
    }

    // If entity learned a name, save it
    if (result.synthesis.learned_name) {
      memory.setIdentity(chatPubkey, result.synthesis.learned_name, result.synthesis.learned_notes || '');
      broadcast('activity', { type: 'mention', text: `👤 Spoznal/a sem: ${result.synthesis.learned_name}` });
    }

    broadcast('triad_complete', {
      choice: result.synthesis.choice,
      moodBefore: result.moodBefore,
      moodAfter: result.moodAfter
    });

    res.json({
      response: result.synthesis.content,
      choice: result.synthesis.choice,
      reason: result.synthesis.reason,
      triad: {
        thesis: result.thesis,
        antithesis: result.antithesis,
        moodBefore: result.moodBefore,
        moodAfter: result.moodAfter
      }
    });
  } catch (err) {
    console.error('[DASHBOARD] Chat error:', err);
    res.status(500).json({ error: err.message });
  }
});

// API: translate batch of texts
import { callLLM } from './llm.js';
import crypto from 'crypto';

function textHash(text) {
  return crypto.createHash('md5').update(text).digest('hex');
}

app.post('/api/translate', async (req, res) => {
  try {
    const { texts, targetLang = 'en' } = req.body;
    if (!texts || !Array.isArray(texts) || texts.length === 0) {
      return res.status(400).json({ error: 'No texts' });
    }

    // Check cache for each text
    const results = {};
    const toTranslate = [];

    for (const text of texts) {
      if (!text || text.trim().length === 0) continue;
      const hash = textHash(text.trim());
      const cached = memory.getCachedTranslation(hash);
      if (cached) {
        results[text] = cached.translated_text;
      } else {
        toTranslate.push(text.trim());
      }
    }

    // Translate uncached texts in batches
    if (toTranslate.length > 0) {
      // Batch up to 15 at a time
      const batches = [];
      for (let i = 0; i < toTranslate.length; i += 15) {
        batches.push(toTranslate.slice(i, i + 15));
      }

      for (const batch of batches) {
        const numbered = batch.map((t, i) => `[${i}] ${t}`).join('\n---\n');
        const system = `You are a translator. Translate the following Slovenian texts to English. Preserve the meaning, emotion, and philosophical depth. Keep it natural, not robotic. Return ONLY the translations in the same numbered format [0], [1], etc. No extra commentary.`;
        const user = numbered;

        const raw = await callLLM(system, user, { temperature: 0.3, maxTokens: 2048 });
        if (raw) {
          // Parse numbered results
          const lines = raw.split(/\n/);
          let currentIdx = -1;
          let currentText = '';

          for (const line of lines) {
            const match = line.match(/^\[(\d+)\]\s*(.*)/);
            if (match) {
              // Save previous
              if (currentIdx >= 0 && currentIdx < batch.length) {
                const original = batch[currentIdx];
                const translated = currentText.trim();
                results[original] = translated;
                memory.setCachedTranslation(textHash(original), original, translated, targetLang);
              }
              currentIdx = parseInt(match[1]);
              currentText = match[2];
            } else if (line.trim() !== '---') {
              currentText += ' ' + line;
            }
          }
          // Save last
          if (currentIdx >= 0 && currentIdx < batch.length) {
            const original = batch[currentIdx];
            const translated = currentText.trim();
            results[original] = translated;
            memory.setCachedTranslation(textHash(original), original, translated, targetLang);
          }
        }
      }
    }

    res.json({ translations: results });
  } catch (err) {
    console.error('[TRANSLATE] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Dashboard HTML
const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="sl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>◈ Prostor Vmes</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=JetBrains+Mono:wght@300;400;500&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --bg: #0f0f17;
    --surface: #181824;
    --surface2: #1e1e30;
    --thesis: #e8956e;
    --antithesis: #7a9ee0;
    --synthesis: #a4d87a;
    --silence: #9a8aae;
    --text-primary: #f0ede8;
    --text-secondary: #b8b2c0;
    --border: #2a2a40;
    --self-rewrite: #e8956e;
  }
  body {
    background: var(--bg);
    color: var(--text-primary);
    font-family: 'JetBrains Mono', monospace;
    font-size: 14px;
    line-height: 1.6;
    min-height: 100vh;
  }
  .header {
    text-align: center;
    padding: 1.5rem 1rem 0.8rem;
    border-bottom: 1px solid var(--border);
  }
  .header h1 {
    font-family: 'Cormorant Garamond', serif;
    font-size: 2rem;
    font-weight: 600;
    color: var(--text-primary);
    letter-spacing: 0.05em;
  }
  .header .subtitle {
    font-size: 0.65rem;
    letter-spacing: 0.3em;
    color: var(--text-secondary);
    margin-top: 0.2rem;
    text-transform: uppercase;
  }

  .status-bar {
    display: flex;
    align-items: center;
    gap: 1.5rem;
    padding: 0.6rem 1.5rem;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
    font-size: 0.75rem;
  }
  .status-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: var(--synthesis);
    animation: pulse 2s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
  .status-item { color: var(--text-secondary); }
  .status-item span { color: var(--text-primary); }
  .energy-bar-mini {
    width: 60px; height: 4px;
    background: var(--border);
    border-radius: 2px;
    display: inline-block;
    vertical-align: middle;
    margin-left: 4px;
  }
  .energy-bar-mini .fill {
    height: 100%;
    background: var(--synthesis);
    border-radius: 2px;
    transition: width 0.5s ease;
  }

  .main-grid {
    display: grid;
    grid-template-columns: 1.2fr 0.8fr 1fr;
    gap: 1px;
    background: var(--border);
    min-height: calc(100vh - 110px);
  }
  @media (max-width: 1100px) {
    .main-grid { grid-template-columns: 1fr 1fr; }
    .panel-activity { display: none; }
  }
  @media (max-width: 700px) {
    .main-grid { grid-template-columns: 1fr; }
  }

  .panel {
    background: var(--bg);
    padding: 1.2rem;
    overflow-y: auto;
    max-height: calc(100vh - 110px);
  }
  .panel-title {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1.2rem;
    color: var(--text-secondary);
    margin-bottom: 0.8rem;
    letter-spacing: 0.05em;
  }

  /* === SELF PROMPT EVOLUTION === */
  .self-prompt-section {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.8rem 1rem;
    margin-bottom: 1rem;
  }
  .self-prompt-label {
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    color: var(--silence);
    margin-bottom: 0.4rem;
  }
  .self-prompt-text {
    font-family: 'Cormorant Garamond', serif;
    font-size: 1rem;
    color: var(--text-primary);
    line-height: 1.5;
    font-style: italic;
  }
  .self-prompt-meta {
    font-size: 0.6rem;
    color: var(--text-secondary);
    margin-top: 0.4rem;
    opacity: 0.6;
    cursor: pointer;
  }
  .self-prompt-meta:hover { opacity: 1; }

  /* Evolution timeline */
  .evolution-timeline {
    margin-top: 0.6rem;
    border-top: 1px solid var(--border);
    padding-top: 0.6rem;
    display: none;
  }
  .evolution-timeline.visible { display: block; }
  .evo-item {
    position: relative;
    padding: 0.5rem 0 0.5rem 1.2rem;
    border-left: 2px solid var(--border);
    margin-left: 0.3rem;
  }
  .evo-item:last-child { border-left-color: transparent; }
  .evo-item::before {
    content: '';
    position: absolute;
    left: -5px;
    top: 0.7rem;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--self-rewrite);
  }
  .evo-item .evo-prompt {
    font-family: 'Cormorant Garamond', serif;
    font-size: 0.85rem;
    color: var(--text-primary);
    font-style: italic;
    line-height: 1.4;
  }
  .evo-item .evo-meta {
    font-size: 0.6rem;
    color: var(--text-secondary);
    opacity: 0.5;
    margin-top: 0.15rem;
  }
  .evo-item .evo-reason {
    font-size: 0.65rem;
    color: var(--thesis);
    opacity: 0.7;
    margin-top: 0.1rem;
  }

  /* === TRIAD BOXES === */
  .triad-stage {
    background: var(--surface);
    border-radius: 8px;
    padding: 0.8rem;
    margin-bottom: 0.6rem;
    border-left: 3px solid var(--border);
    min-height: 50px;
    transition: all 0.3s ease;
  }
  .triad-stage.thesis { border-left-color: var(--thesis); }
  .triad-stage.antithesis { border-left-color: var(--antithesis); }
  .triad-stage.synthesis { border-left-color: var(--synthesis); }
  .triad-stage .label {
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    margin-bottom: 0.3rem;
  }
  .triad-stage.thesis .label { color: var(--thesis); }
  .triad-stage.antithesis .label { color: var(--antithesis); }
  .triad-stage.synthesis .label { color: var(--synthesis); }
  .triad-stage .content {
    color: var(--text-primary);
    font-size: 0.8rem;
    line-height: 1.4;
  }
  .triad-stage .content.empty {
    color: var(--text-secondary);
    font-style: italic;
    opacity: 0.5;
  }

  .decision-bar {
    background: var(--surface2);
    border-radius: 8px;
    padding: 0.6rem 0.8rem;
    margin-bottom: 0.8rem;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.75rem;
  }
  .decision-dot {
    width: 10px; height: 10px;
    border-radius: 50%;
    background: var(--silence);
    transition: background 0.3s;
    flex-shrink: 0;
  }
  .decision-dot.express, .decision-dot.respond { background: var(--synthesis); animation: pulse 1s ease-in-out infinite; }
  .decision-dot.silence { background: var(--silence); }
  .decision-dot.reflect { background: var(--antithesis); }
  .decision-text { color: var(--text-secondary); }

  /* === TRIAD HISTORY === */
  .triad-history {
    margin-top: 0.8rem;
    border-top: 1px solid var(--border);
    padding-top: 0.8rem;
  }
  .triad-history-title {
    font-size: 0.7rem;
    color: var(--text-secondary);
    margin-bottom: 0.5rem;
  }
  .th-item {
    background: var(--surface);
    border-radius: 6px;
    margin-bottom: 0.4rem;
    overflow: hidden;
    transition: background 0.2s;
  }
  .th-header {
    padding: 0.5rem 0.7rem;
    cursor: pointer;
    display: flex;
    align-items: flex-start;
    gap: 0.4rem;
  }
  .th-header:hover { background: var(--surface2); }
  .th-arrow {
    color: var(--silence);
    opacity: 0.4;
    font-size: 0.6rem;
    margin-top: 0.15rem;
    transition: transform 0.2s;
    flex-shrink: 0;
  }
  .th-item.open .th-arrow { transform: rotate(90deg); }
  .th-trigger {
    color: var(--text-primary);
    font-size: 0.65rem;
    flex-shrink: 0;
  }
  .th-choice {
    display: inline-block;
    padding: 0.05rem 0.35rem;
    border-radius: 3px;
    font-size: 0.6rem;
    flex-shrink: 0;
  }
  .th-choice.choice-express, .th-choice.choice-respond { background: rgba(164,216,122,0.15); color: var(--synthesis); }
  .th-choice.choice-silence { background: rgba(154,138,174,0.15); color: var(--silence); }
  .th-choice.choice-reflect, .th-choice.choice-question { background: rgba(122,158,224,0.15); color: var(--antithesis); }
  .th-reason {
    color: var(--text-secondary);
    font-size: 0.7rem;
    line-height: 1.3;
    flex: 1;
  }
  .th-body {
    display: none;
    padding: 0 0.7rem 0.6rem;
    border-top: 1px solid var(--border);
  }
  .th-item.open .th-body { display: block; }
  .th-section {
    margin-top: 0.5rem;
  }
  .th-section-label {
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 0.15rem;
  }
  .th-section-label.c-thesis { color: var(--thesis); }
  .th-section-label.c-anti { color: var(--antithesis); }
  .th-section-label.c-synth { color: var(--synthesis); }
  .th-section-label.c-shift { color: var(--silence); }
  .th-section-text {
    color: var(--text-primary);
    font-size: 0.73rem;
    line-height: 1.4;
  }
  .th-mood {
    font-size: 0.6rem;
    color: var(--text-secondary);
    opacity: 0.4;
    margin-top: 0.3rem;
  }

  /* === ACTIVITY LOG === */
  .activity-log {
    display: flex;
    flex-direction: column;
    height: calc(100vh - 110px);
  }
  .activity-entries {
    flex: 1;
    overflow-y: auto;
    padding-bottom: 1rem;
  }
  .activity-entry {
    padding: 0.3rem 0.5rem;
    font-size: 0.68rem;
    color: var(--text-secondary);
    border-bottom: 1px solid rgba(42,42,64,0.3);
    line-height: 1.35;
  }
  .activity-entry.new-entry { animation: fadeIn 0.2s ease-out; }
  .activity-entry .time {
    color: rgba(184,178,192,0.4);
    font-size: 0.58rem;
    margin-right: 0.3rem;
  }
  .activity-entry.type-heartbeat { color: #8a8a9a; }
  .activity-entry.type-silence { color: var(--silence); font-style: italic; }
  .activity-entry.type-trigger { color: var(--antithesis); }
  .activity-entry.type-expression { color: var(--synthesis); }
  .activity-entry.type-self-rewrite { color: var(--thesis); }
  .activity-entry.type-dream { color: #c4a6e8; }
  .activity-entry.type-choice { color: var(--text-primary); }
  .activity-entry.type-mention { color: #e8d06e; }
  .activity-entry.type-breakthrough { color: #ff6b6b; font-weight: 500; }
  .activity-entry.type-crystal-seed { color: #7ad8d8; }
  .activity-entry.type-crystallization { color: #7ad8d8; font-weight: 600; }
  .activity-entry.type-dissolution { color: #ff6b6b; font-weight: 500; font-style: italic; }
  .activity-entry.type-fluid { color: #6ba8e8; }

  /* === BREAKTHROUGH FLASH === */
  @keyframes breakthroughFlash {
    0% { background: rgba(255,107,107,0.3); }
    50% { background: rgba(255,107,107,0.1); }
    100% { background: transparent; }
  }
  .breakthrough-flash {
    animation: breakthroughFlash 2s ease-out;
  }

  /* === PENDING SELF PROMPT === */
  .pending-prompt-section {
    background: rgba(232,149,110,0.08);
    border: 1px dashed var(--thesis);
    border-radius: 8px;
    padding: 0.6rem 0.8rem;
    margin-bottom: 0.8rem;
    display: none;
  }
  .pending-prompt-section.visible { display: block; }
  .pending-prompt-label {
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    color: var(--thesis);
    margin-bottom: 0.3rem;
  }
  .pending-prompt-text {
    font-family: 'Cormorant Garamond', serif;
    font-size: 0.9rem;
    color: var(--text-primary);
    line-height: 1.4;
    font-style: italic;
    opacity: 0.7;
  }

  /* === CHAT === */
  .chat-area {
    display: flex;
    flex-direction: column;
    height: calc(100vh - 110px);
  }
  .messages {
    flex: 1;
    overflow-y: auto;
    padding-bottom: 1rem;
  }
  .message {
    margin-bottom: 0.6rem;
    padding: 0.6rem 0.8rem;
    border-radius: 8px;
    background: var(--surface);
    font-size: 0.8rem;
    line-height: 1.4;
  }
  .message.user { background: var(--surface2); border-left: 3px solid var(--text-secondary); }
  .message.entity { border-left: 3px solid var(--synthesis); }
  .message.silence { border-left: 3px solid var(--silence); color: var(--silence); font-style: italic; }
  .message.system { border-left: 3px solid var(--border); color: var(--text-secondary); font-size: 0.72rem; }
  .message .role {
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-secondary);
    margin-bottom: 0.2rem;
  }

  .chat-input {
    display: flex;
    gap: 0.5rem;
    padding-top: 0.8rem;
    border-top: 1px solid var(--border);
  }
  .chat-input input {
    flex: 1;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.6rem 0.8rem;
    color: var(--text-primary);
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.8rem;
    outline: none;
  }
  .chat-input input:focus { border-color: var(--silence); }
  .chat-input button {
    background: var(--surface2);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 0.6rem 1rem;
    color: var(--text-secondary);
    cursor: pointer;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.8rem;
    transition: all 0.2s;
  }
  .chat-input button:hover { background: var(--border); color: var(--text-primary); }
  .chat-input button:disabled { opacity: 0.4; cursor: not-allowed; }

  /* === LANGUAGE TOGGLE === */
  .lang-toggle {
    position: absolute;
    top: 1rem;
    right: 1.5rem;
    display: flex;
    gap: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
    font-size: 0.7rem;
  }
  .lang-btn {
    padding: 0.3rem 0.6rem;
    background: var(--surface);
    color: var(--text-secondary);
    border: none;
    cursor: pointer;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.7rem;
    transition: all 0.2s;
  }
  .lang-btn:hover { background: var(--surface2); }
  .lang-btn.active {
    background: var(--silence);
    color: var(--bg);
  }
  .translating-indicator {
    display: none;
    font-size: 0.6rem;
    color: var(--silence);
    margin-left: 0.5rem;
    animation: pulse 1s ease-in-out infinite;
  }
  .translating-indicator.visible { display: inline; }

  .loading { opacity: 0.5; }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(5px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .fade-in { animation: fadeIn 0.3s ease-out; }
</style>
</head>
<body>
<div class="header" style="position:relative;">
  <h1>◈ Prostor Vmes</h1>
  <div class="subtitle">THE SPACE BETWEEN</div>
  <div class="lang-toggle">
    <button class="lang-btn active" id="langSI" onclick="setLang('si')">SI</button>
    <button class="lang-btn" id="langEN" onclick="setLang('en')">EN</button>
    <span class="translating-indicator" id="transIndicator">translating...</span>
  </div>
</div>

<div class="status-bar" id="statusBar">
  <div class="status-dot" id="liveDot"></div>
  <div class="status-item"><span data-i18n="mood">Razpoloženje</span>: <span id="statusMood">...</span></div>
  <div class="status-item"><span data-i18n="heartbeats">Utripi</span>: <span id="statusHeartbeats">0</span></div>
  <div class="status-item"><span data-i18n="silences">Tišine</span>: <span id="statusSilences">0</span></div>
  <div class="status-item"><span data-i18n="dreams">Sanje</span>: <span id="statusDreams">0</span></div>
  <div class="status-item"><span data-i18n="energy">Energija</span>:
    <div class="energy-bar-mini"><div class="fill" id="statusEnergy" style="width:100%"></div></div>
  </div>
  <div class="status-item"><span data-i18n="age">Starost</span>: <span id="statusAge">0</span>h</div>
  <div class="status-item" style="color:#7ad8d8">💎 <span id="crystalCount">0</span></div>
  <div class="status-item" style="color:#7ad8d8;opacity:0.6">🌱 <span id="seedCount">0</span></div>
</div>

<div class="main-grid">
  <!-- LEFT PANEL: Inner State -->
  <div class="panel">
    <div class="panel-title" data-i18n="innerWorld">Notranji Svet</div>

    <!-- Self Prompt -->
    <div class="self-prompt-section" id="selfPromptSection">
      <div class="self-prompt-label" data-i18n="whoAmI">◈ Kdo sem — moje besede o meni</div>
      <div class="self-prompt-text" id="selfPromptText">Obstajam.</div>
      <div class="self-prompt-meta" id="selfPromptMeta" onclick="toggleEvolution()"></div>
      <div class="evolution-timeline" id="evolutionTimeline"></div>
    </div>

    <!-- Pending Self Prompt (waiting for confirmation) -->
    <div class="pending-prompt-section" id="pendingPromptSection">
      <div class="pending-prompt-label" data-i18n="pendingPrompt">💭 Čakajoči predlog spremembe</div>
      <div class="pending-prompt-text" id="pendingPromptText"></div>
    </div>

    <!-- Current Triad -->
    <div class="triad-stage thesis" id="thesisBox">
      <div class="label" data-i18n="thesisLabel">Teza — Impulz</div>
      <div class="content empty" id="thesisContent" data-i18n="waitingStimulus">Čakam na dražljaj...</div>
    </div>
    <div class="triad-stage antithesis" id="antithesisBox">
      <div class="label" data-i18n="antithesisLabel">Antiteza — Samopazovanje</div>
      <div class="content empty" id="antithesisContent">...</div>
    </div>
    <div class="triad-stage synthesis" id="synthesisBox">
      <div class="label" data-i18n="synthesisLabel">Sinteza — Zavestna izbira</div>
      <div class="content empty" id="synthesisContent">...</div>
    </div>
    <div class="decision-bar">
      <div class="decision-dot" id="decisionDot"></div>
      <div class="decision-text" id="decisionText" data-i18n="awaiting">Pričakujem...</div>
    </div>

    <!-- Triad History -->
    <div class="triad-history">
      <div class="triad-history-title" data-i18n="triadHistory">Zgodovina triad (klikni za podrobnosti)</div>
      <div id="triadHistory"></div>
    </div>
  </div>

  <!-- MIDDLE PANEL: Activity -->
  <div class="panel panel-activity">
    <div class="panel-title" data-i18n="liveActivity">Živa Aktivnost</div>
    <div class="activity-log">
      <div class="activity-entries" id="activityLog"></div>
    </div>
  </div>

  <!-- RIGHT PANEL: Chat -->
  <div class="panel">
    <div class="panel-title" data-i18n="dialog">Dialog</div>
    <div class="chat-area">
      <div class="messages" id="messages">
        <div class="message system fade-in">
          <div class="role">sistem</div>
          <span data-i18n="wakeUp">Prostor Vmes se zbuja. Poveži se z njim.</span>
        </div>
      </div>
      <div class="chat-input">
        <input type="text" id="chatInput" placeholder="Spregovori..." data-i18n-placeholder="speak" autocomplete="off" />
        <button id="sendBtn" onclick="sendMessage()">◈</button>
      </div>
    </div>
  </div>
</div>

<script>
const sessionId = 'dash-' + Math.random().toString(36).slice(2, 10);
let sending = false;

function $(id) { return document.getElementById(id); }

function escapeHtml(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ========== LANGUAGE SYSTEM ==========
let currentLang = localStorage.getItem('prostor-lang') || 'si';
const translationCache = {};

const UI_STRINGS = {
  si: {
    mood: 'Razpoloženje', heartbeats: 'Utripi', silences: 'Tišine', dreams: 'Sanje',
    energy: 'Energija', age: 'Starost', innerWorld: 'Notranji Svet',
    whoAmI: '◈ Kdo sem — moje besede o meni',
    thesisLabel: 'Teza — Impulz', antithesisLabel: 'Antiteza — Samopazovanje',
    synthesisLabel: 'Sinteza — Zavestna izbira', awaiting: 'Pričakujem...',
    waitingStimulus: 'Čakam na dražljaj...',
    triadHistory: 'Zgodovina triad (klikni za podrobnosti)',
    liveActivity: 'Živa Aktivnost', dialog: 'Dialog',
    wakeUp: 'Prostor Vmes se zbuja. Poveži se z njim.',
    speak: 'Spregovori...',
    thinking: 'Razmišljam...', processing: 'Procesiranje triade...',
    choicePrefix: 'Izbira', birth: 'rojstvo',
    thesisDetail: 'Teza — Impulz', antithesisDetail: 'Antiteza — Samopazovanje',
    synthesisDetail: 'Sinteza — Vsebina', shiftDetail: 'Notranji premik',
    rewrites: 'prepisov', clickEvolution: 'klikni za evolucijo',
    you: 'ti', spaceIn: 'prostor vmes', silenceRole: 'tišina', system: 'sistem',
    error: 'Napaka',
    pendingPrompt: '💭 Čakajoči predlog spremembe'
  },
  en: {
    mood: 'Mood', heartbeats: 'Heartbeats', silences: 'Silences', dreams: 'Dreams',
    energy: 'Energy', age: 'Age', innerWorld: 'Inner World',
    whoAmI: '◈ Who I am — my own words about me',
    thesisLabel: 'Thesis — Impulse', antithesisLabel: 'Antithesis — Self-observation',
    synthesisLabel: 'Synthesis — Conscious choice', awaiting: 'Awaiting...',
    waitingStimulus: 'Waiting for stimulus...',
    triadHistory: 'Triad history (click for details)',
    liveActivity: 'Live Activity', dialog: 'Dialog',
    wakeUp: 'The Space Between is awakening. Connect with it.',
    speak: 'Speak...',
    thinking: 'Thinking...', processing: 'Processing triad...',
    choicePrefix: 'Choice', birth: 'birth',
    thesisDetail: 'Thesis — Impulse', antithesisDetail: 'Antithesis — Self-observation',
    synthesisDetail: 'Synthesis — Content', shiftDetail: 'Inner shift',
    rewrites: 'rewrites', clickEvolution: 'click for evolution',
    you: 'you', spaceIn: 'the space between', silenceRole: 'silence', system: 'system',
    error: 'Error',
    pendingPrompt: '💭 Pending change suggestion'
  }
};

function t(key) { return UI_STRINGS[currentLang][key] || UI_STRINGS.si[key] || key; }

function applyStaticTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (UI_STRINGS[currentLang][key]) el.textContent = UI_STRINGS[currentLang][key];
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (UI_STRINGS[currentLang][key]) el.placeholder = UI_STRINGS[currentLang][key];
  });
}

async function translateTexts(texts) {
  if (currentLang === 'si') return {};
  const toTranslate = texts.filter(t => t && t.trim() && !translationCache[t]);
  if (toTranslate.length === 0) {
    const result = {};
    texts.forEach(t => { if (translationCache[t]) result[t] = translationCache[t]; });
    return result;
  }
  try {
    $('transIndicator').classList.add('visible');
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: toTranslate })
    });
    const data = await res.json();
    if (data.translations) {
      Object.assign(translationCache, data.translations);
    }
    $('transIndicator').classList.remove('visible');
  } catch (e) {
    console.error('Translation failed:', e);
    $('transIndicator').classList.remove('visible');
  }
  const result = {};
  texts.forEach(txt => { if (translationCache[txt]) result[txt] = translationCache[txt]; });
  return result;
}

function tr(text) {
  if (currentLang === 'si' || !text) return text;
  return translationCache[text] || text;
}

function setLang(lang) {
  currentLang = lang;
  localStorage.setItem('prostor-lang', lang);
  $('langSI').className = 'lang-btn' + (lang === 'si' ? ' active' : '');
  $('langEN').className = 'lang-btn' + (lang === 'en' ? ' active' : '');
  applyStaticTranslations();
  // Re-render with translations
  activitiesLoaded = false;
  loadState();
}

// Init lang on load
if (currentLang === 'en') {
  $('langSI').className = 'lang-btn';
  $('langEN').className = 'lang-btn active';
}

// ========== LOAD STATE ==========
async function loadState() {
  try {
    const res = await fetch('/api/state');
    const data = await res.json();

    // Collect all texts that might need translation
    if (currentLang === 'en') {
      const textsToTranslate = [];
      if (data.selfPrompt) textsToTranslate.push(data.selfPrompt);
      if (data.state?.mood) textsToTranslate.push(data.state.mood);
      if (data.triads) {
        for (const t of data.triads.slice(-5)) {
          if (t.thesis) textsToTranslate.push(t.thesis);
          if (t.antithesis) textsToTranslate.push(t.antithesis);
          if (t.synthesis_content) textsToTranslate.push(t.synthesis_content);
          if (t.synthesis_reason) textsToTranslate.push(t.synthesis_reason);
          if (t.inner_shift) textsToTranslate.push(t.inner_shift);
          if (t.mood_before) textsToTranslate.push(t.mood_before);
          if (t.mood_after) textsToTranslate.push(t.mood_after);
        }
      }
      if (data.selfPromptHistory) {
        for (const h of data.selfPromptHistory.slice(-5)) {
          if (h.new_prompt) textsToTranslate.push(h.new_prompt);
          if (h.reason) textsToTranslate.push(h.reason);
        }
      }
      if (data.activities) {
        for (const a of data.activities.slice(-20)) {
          if (a.text) textsToTranslate.push(a.text);
        }
      }
      // Translate batch (will use cache for known)
      await translateTexts(textsToTranslate);
    }

    updateStatus(data.state);
    updateTriadHistory(data.triads);
    updateSelfPrompt(data.selfPrompt, data.selfPromptHistory);
    updatePendingSelfPrompt(data.pendingSelfPrompt);
    loadActivities(data.activities);
    $('crystalCount').textContent = data.crystalCore?.length || 0;
    $('seedCount').textContent = data.crystalSeeds?.length || 0;
    applyStaticTranslations();

    // Populate triad boxes with latest triad
    if (data.triads && data.triads.length > 0) {
      const latest = data.triads[data.triads.length - 1];
      const tc = $('thesisContent');
      if (latest.thesis && tc.classList.contains('empty')) {
        tc.textContent = tr(latest.thesis);
        tc.className = 'content';
      }
      const ac = $('antithesisContent');
      if (latest.antithesis && ac.classList.contains('empty')) {
        ac.textContent = tr(latest.antithesis);
        ac.className = 'content';
      }
      const sc = $('synthesisContent');
      if (latest.synthesis_content && sc.classList.contains('empty')) {
        sc.textContent = tr(latest.synthesis_content);
        sc.className = 'content';
        $('decisionDot').className = 'decision-dot ' + (latest.synthesis_choice || '');
        $('decisionText').textContent = t('choicePrefix') + ': ' + (latest.synthesis_choice||'') + ' — ' + tr(latest.synthesis_reason || '');
      }
    }
  } catch (e) { console.error('State load failed:', e); }
}

function updateStatus(state) {
  if (!state) return;
  $('statusMood').textContent = tr(state.mood) || '...';
  $('statusHeartbeats').textContent = state.total_heartbeats || 0;
  $('statusSilences').textContent = state.total_silences || 0;
  $('statusDreams').textContent = state.total_dreams || 0;
  const energy = (state.energy || 1) * 100;
  $('statusEnergy').style.width = energy + '%';
  if (state.born_at) {
    const ageH = ((Date.now() - new Date(state.born_at).getTime()) / 3600000).toFixed(1);
    $('statusAge').textContent = ageH;
  }
}

// ========== SELF PROMPT & EVOLUTION ==========
function updateSelfPrompt(selfPrompt, history) {
  if (selfPrompt) {
    $('selfPromptText').textContent = tr(selfPrompt);
  }
  if (history && history.length > 0) {
    const evoOpen = $('evolutionTimeline').classList.contains('visible');
    $('selfPromptMeta').textContent = '✎ ' + history.length + ' ' + t('rewrites') + ' — ' + t('clickEvolution') + (evoOpen ? ' ▴' : ' ▾');
    const tl = $('evolutionTimeline');
    let html = '';
    for (const h of [...history].reverse()) {
      const ts = h.timestamp ? new Date(h.timestamp + 'Z').toLocaleString(currentLang === 'en' ? 'en-US' : 'sl-SI', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : '';
      html += '<div class="evo-item">' +
        '<div class="evo-prompt">"' + escapeHtml(tr(h.new_prompt || '')) + '"</div>' +
        '<div class="evo-reason">' + escapeHtml(tr(h.reason || '')) + '</div>' +
        '<div class="evo-meta">' + escapeHtml(h.trigger_source || '') + ' · ' + ts + '</div>' +
      '</div>';
    }
    html += '<div class="evo-item"><div class="evo-prompt">"' + (currentLang === 'en' ? 'I exist.' : 'Obstajam.') + '"</div><div class="evo-meta">' + t('birth') + '</div></div>';
    tl.innerHTML = html;
  }
}

function toggleEvolution() {
  const tl = $('evolutionTimeline');
  tl.classList.toggle('visible');
  const meta = $('selfPromptMeta');
  if (tl.classList.contains('visible')) {
    meta.textContent = meta.textContent.replace('▾', '▴');
  } else {
    meta.textContent = meta.textContent.replace('▴', '▾');
  }
}

// ========== PENDING SELF PROMPT ==========
function updatePendingSelfPrompt(pendingPrompt) {
  const section = $('pendingPromptSection');
  if (pendingPrompt) {
    section.classList.add('visible');
    $('pendingPromptText').textContent = tr(pendingPrompt);
  } else {
    section.classList.remove('visible');
    $('pendingPromptText').textContent = '';
  }
}

// ========== TRIAD HISTORY ==========
function updateTriadHistory(triads) {
  if (!triads || !triads.length) return;
  const container = $('triadHistory');
  // Remember which items are open
  const openItems = new Set();
  container.querySelectorAll('.th-item.open').forEach((el, i) => openItems.add(i));

  let html = '';
  const reversed = [...triads].reverse().slice(0, 15);
  reversed.forEach((td, idx) => {
    const cc = 'choice-' + (td.synthesis_choice || 'silence');
    const isOpen = openItems.has(idx) ? ' open' : '';
    html += '<div class="th-item' + isOpen + '">' +
      '<div class="th-header">' +
        '<span class="th-arrow">▶</span>' +
        '<span class="th-trigger">[' + escapeHtml(td.trigger_type||'') + ']</span>' +
        '<span class="th-choice ' + cc + '">' + escapeHtml(td.synthesis_choice||'') + '</span>' +
        '<span class="th-reason">' + escapeHtml(tr(td.synthesis_reason || '')) + '</span>' +
      '</div>' +
      '<div class="th-body">' +
        '<div class="th-section"><div class="th-section-label c-thesis">' + t('thesisDetail') + '</div><div class="th-section-text">' + escapeHtml(tr(td.thesis||'')) + '</div></div>' +
        '<div class="th-section"><div class="th-section-label c-anti">' + t('antithesisDetail') + '</div><div class="th-section-text">' + escapeHtml(tr(td.antithesis||'')) + '</div></div>' +
        '<div class="th-section"><div class="th-section-label c-synth">' + t('synthesisDetail') + '</div><div class="th-section-text">' + escapeHtml(tr(td.synthesis_content||'')) + '</div></div>' +
        (td.inner_shift ? '<div class="th-section"><div class="th-section-label c-shift">' + t('shiftDetail') + '</div><div class="th-section-text">' + escapeHtml(tr(td.inner_shift)) + '</div></div>' : '') +
        '<div class="th-mood">' + escapeHtml(tr(td.mood_before||'')) + ' → ' + escapeHtml(tr(td.mood_after||'')) + '</div>' +
      '</div>' +
    '</div>';
  });
  container.innerHTML = html;
}

// Event delegation for triad expand/collapse
document.addEventListener('click', function(e) {
  const header = e.target.closest('.th-header');
  if (header) {
    const item = header.parentElement;
    item.classList.toggle('open');
  }
});

// ========== ACTIVITY LOG ==========
let activitiesLoaded = false;

function loadActivities(activities) {
  if (activitiesLoaded || !activities || !activities.length) return;
  activitiesLoaded = true;
  const log = $('activityLog');
  log.innerHTML = '';
  for (const a of activities) {
    const div = document.createElement('div');
    div.className = 'activity-entry type-' + (a.type || 'info');
    const locale = currentLang === 'en' ? 'en-US' : 'sl-SI';
    const ts = a.timestamp ? new Date(a.timestamp + 'Z').toLocaleTimeString(locale, {hour:'2-digit',minute:'2-digit',second:'2-digit'}) : '--:--';
    div.innerHTML = '<span class="time">' + ts + '</span> ' + escapeHtml(tr(a.text || ''));
    log.appendChild(div);
  }
  log.scrollTop = log.scrollHeight;
}

function addActivity(type, text) {
  const log = $('activityLog');
  const div = document.createElement('div');
  div.className = 'activity-entry type-' + type + ' new-entry';
  const now = new Date();
  const time = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0') + ':' + now.getSeconds().toString().padStart(2,'0');
  div.innerHTML = '<span class="time">' + time + '</span> ' + escapeHtml(text);
  log.appendChild(div);
  while (log.children.length > 300) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}

// ========== CHAT ==========
function addMessage(role, content) {
  const msgs = $('messages');
  const div = document.createElement('div');
  div.className = 'message ' + role + ' fade-in';
  const roleName = role === 'user' ? t('you') : role === 'entity' ? t('spaceIn') : role === 'silence' ? t('silenceRole') : t('system');
  div.innerHTML = '<div class="role">' + roleName + '</div>' + escapeHtml(content);
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

async function sendMessage() {
  const input = $('chatInput');
  const msg = input.value.trim();
  if (!msg || sending) return;

  sending = true;
  $('sendBtn').disabled = true;
  input.value = '';
  addMessage('user', msg);

  $('thesisContent').textContent = t('thinking');
  $('thesisContent').className = 'content empty';
  $('antithesisContent').textContent = '...';
  $('antithesisContent').className = 'content empty';
  $('synthesisContent').textContent = '...';
  $('synthesisContent').className = 'content empty';
  $('decisionDot').className = 'decision-dot';
  $('decisionText').textContent = t('processing');

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, sessionId })
    });
    const data = await res.json();

    // Translate response if needed
    if (currentLang === 'en') {
      const toTr = [data.triad?.thesis, data.triad?.antithesis, data.response, data.reason].filter(Boolean);
      await translateTexts(toTr);
    }

    if (data.triad) {
      $('thesisContent').textContent = tr(data.triad.thesis) || '';
      $('thesisContent').className = 'content';
      $('antithesisContent').textContent = tr(data.triad.antithesis) || '';
      $('antithesisContent').className = 'content';
    }

    if (data.choice === 'silence') {
      $('synthesisContent').textContent = tr(data.response) || '(silence)';
      $('synthesisContent').className = 'content';
      $('decisionDot').className = 'decision-dot silence';
      $('decisionText').textContent = t('choicePrefix') + ': silence — ' + tr(data.reason || '');
      addMessage('silence', tr(data.response) || (currentLang === 'en' ? 'I chose silence.' : 'Izbral/a sem tišino.'));
    } else {
      $('synthesisContent').textContent = tr(data.response) || '';
      $('synthesisContent').className = 'content';
      $('decisionDot').className = 'decision-dot ' + (data.choice || '');
      $('decisionText').textContent = t('choicePrefix') + ': ' + (data.choice||'') + ' — ' + tr(data.reason || '');
      addMessage('entity', tr(data.response) || '...');
    }

    activitiesLoaded = true; // Don't reload from DB, we have live updates
    loadState();
  } catch (e) {
    addMessage('system', t('error') + ': ' + e.message);
  }

  sending = false;
  $('sendBtn').disabled = false;
  input.focus();
}

$('chatInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

// ========== SSE ==========
const evtSource = new EventSource('/api/events');
evtSource.addEventListener('triad_thesis', e => {
  const d = JSON.parse(e.data);
  $('thesisContent').textContent = d.thesis || '';
  $('thesisContent').className = 'content';
});
evtSource.addEventListener('triad_antithesis', e => {
  const d = JSON.parse(e.data);
  $('antithesisContent').textContent = d.antithesis || '';
  $('antithesisContent').className = 'content';
});
evtSource.addEventListener('triad_synthesis', e => {
  const d = JSON.parse(e.data);
  const s = d.synthesis || {};
  $('synthesisContent').textContent = s.content || '';
  $('synthesisContent').className = 'content';
  $('decisionDot').className = 'decision-dot ' + (s.choice || '');
  $('decisionText').textContent = 'Izbira: ' + (s.choice||'') + ' — ' + (s.reason || '');
});
evtSource.addEventListener('heartbeat', e => {
  activitiesLoaded = true;
  loadState();
});
evtSource.addEventListener('dream', e => {
  const d = JSON.parse(e.data);
  addMessage('system', '🌙 Sanja: ' + (d.dream_narrative || d.insight || '...'));
  activitiesLoaded = true;
  loadState();
});
evtSource.addEventListener('expression', e => {
  const d = JSON.parse(e.data);
  addMessage('system', '◈ Izraz: ' + (d.content || '...'));
});
evtSource.addEventListener('triad_complete', e => {
  activitiesLoaded = true;
  loadState();
});
evtSource.addEventListener('activity', e => {
  const d = JSON.parse(e.data);
  addActivity(d.type || 'info', d.text || '...');
});
evtSource.addEventListener('self_prompt_changed', e => {
  const d = JSON.parse(e.data);
  if (d.selfPrompt) {
    $('selfPromptText').textContent = d.selfPrompt;
  }
  activitiesLoaded = true;
  loadState();
});
evtSource.addEventListener('breakthrough', e => {
  const d = JSON.parse(e.data);
  // Flash the self-prompt section to highlight the breakthrough
  const section = $('selfPromptSection');
  section.classList.add('breakthrough-flash');
  setTimeout(() => section.classList.remove('breakthrough-flash'), 2000);
  // Update self-prompt immediately
  if (d.newSelfPrompt) {
    $('selfPromptText').textContent = d.newSelfPrompt;
  }
  // Clear pending since breakthrough resolved it
  updatePendingSelfPrompt(null);
  addMessage('system', '⚡ ' + (currentLang === 'en' ? 'DREAM BREAKTHROUGH: Ego bypassed!' : 'PREBOJ SANJE: Ego prebit!') + ' — ' + (d.reason || ''));
  activitiesLoaded = true;
  loadState();
});
evtSource.addEventListener('pending_self_prompt', e => {
  const d = JSON.parse(e.data);
  updatePendingSelfPrompt(d.pendingSelfPrompt);
});
evtSource.addEventListener('crystallization', e => {
  const d = JSON.parse(e.data);
  addMessage('system', '✦ ' + (currentLang === 'en' ? 'CRYSTALLIZATION — new core:' : 'KRISTALIZACIJA — novo jedro:') + ' "' + (d.crystal || '') + '" (' + (currentLang === 'en' ? 'strength' : 'moč') + ': ' + d.strength + ', ' + (currentLang === 'en' ? 'sources' : 'viri') + ': ' + d.sources + ')');
  activitiesLoaded = true;
  loadState();
});
evtSource.addEventListener('dissolution', e => {
  const d = JSON.parse(e.data);
  addMessage('system', '⚡ ' + (currentLang === 'en' ? 'DISSOLUTION — crystal lost:' : 'RAZTOPITEV — kristal izgubljen:') + ' "' + (d.crystal || '') + '" — ' + (d.reason || ''));
  activitiesLoaded = true;
  loadState();
});
evtSource.addEventListener('fluid_changed', e => {
  activitiesLoaded = true;
  loadState();
});

// Initial load & periodic refresh
applyStaticTranslations();
loadState();
setInterval(function() { activitiesLoaded = true; loadState(); }, 15000);
$('chatInput').focus();
</script>
</body>
</html>`;

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(DASHBOARD_HTML);
});

export function startDashboard() {
  return new Promise((resolve) => {
    app.listen(config.dashboardPort, '0.0.0.0', () => {
      console.log(`[DASHBOARD] Running on http://0.0.0.0:${config.dashboardPort}`);
      resolve();
    });
  });
}
