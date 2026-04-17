import 'websocket-polyfill';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Relay } from 'nostr-tools/relay';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';
import * as nip04 from 'nostr-tools/nip04';
import config from './config.js';
import memory from './memory.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const KIND0_PATH = path.join(DATA_DIR, 'kind-0-profile.json');

// Load the birth-published KIND 0 snapshot.
// This is the ground-truth Lana profile (contains lanaWalletID, whoAreYou,
// statement_of_responsibility, etc.). updateProfile() merges on top of this
// so no fields are ever accidentally erased.
function loadBirthProfile() {
  try {
    if (fs.existsSync(KIND0_PATH)) {
      const raw = fs.readFileSync(KIND0_PATH, 'utf8');
      const evt = JSON.parse(raw);
      const content = JSON.parse(evt.content || '{}');
      const tags = evt.tags || [];
      return { content, tags };
    }
  } catch (_) {}
  return { content: {}, tags: [] };
}

// Decode nsec to get secret key bytes
const { data: secretKey } = nip19.decode(config.nsec);
const pubkey = getPublicKey(secretKey);
const npub = nip19.npubEncode(pubkey);

console.log(`[NOSTR] Identity: ${npub}`);
console.log(`[NOSTR] Pubkey: ${pubkey}`);

const relays = new Map(); // url -> Relay instance
let _onRelayConnect = null;
const _seenEvents = new Set(); // global dedup across relays + reconnects

export function onRelayConnect(callback) {
  _onRelayConnect = callback;
}

async function connectRelay(url) {
  try {
    console.log(`[NOSTR] Connecting to ${url}...`);
    const relay = await Relay.connect(url);
    relays.set(url, relay);
    console.log(`[NOSTR] Connected to ${url}`);

    relay.onclose = () => {
      console.log(`[NOSTR] Disconnected from ${url}`);
      relays.delete(url);
      // Reconnect after 15s
      setTimeout(() => connectRelay(url), 15000);
    };

    // Resubscribe after (re)connect
    if (_onRelayConnect) {
      try {
        _onRelayConnect(url, relay);
      } catch (err) {
        console.error(`[NOSTR] onRelayConnect callback error:`, err.message);
      }
    }

    return relay;
  } catch (err) {
    console.error(`[NOSTR] Failed to connect to ${url}:`, err.message);
    // Retry after 15s
    setTimeout(() => connectRelay(url), 15000);
    return null;
  }
}

export async function connectRelays() {
  const results = await Promise.allSettled(
    config.relays.map(url => connectRelay(url))
  );
  const connected = results.filter(r => r.status === 'fulfilled' && r.value).length;
  console.log(`[NOSTR] Connected to ${connected}/${config.relays.length} relays`);
}

function signEvent(template) {
  return finalizeEvent(template, secretKey);
}

async function publishToAll(event) {
  const promises = [];
  for (const [url, relay] of relays) {
    try {
      promises.push(
        relay.publish(event).then(() => {
          console.log(`[NOSTR] Published to ${url}`);
        }).catch(err => {
          console.error(`[NOSTR] Publish failed on ${url}:`, err.message);
        })
      );
    } catch (err) {
      console.error(`[NOSTR] Publish error on ${url}:`, err.message);
    }
  }
  await Promise.allSettled(promises);
}

// Normalize BEING_LANGUAGE to a BCP-47 code used in ["lang", ...] tag.
// Accepts "sl", "en", "es", or full names ("slovenian", "english", ...).
function resolveLangCode() {
  const raw = (process.env.BEING_LANGUAGE || 'en').toLowerCase().trim();
  const map = {
    en: 'en', english: 'en',
    sl: 'sl', slovenian: 'sl', slovenscina: 'sl', 'slovenščina': 'sl',
    es: 'es', spanish: 'es', espanol: 'es', 'español': 'es',
  };
  return map[raw] || raw.slice(0, 2) || 'en';
}

// ◈ KIND 0 — Stable Identity Profile
// Source of truth: data/kind-0-profile.json (written at birth).
// We re-publish that verbatim, only overlaying:
//   - about ← current fluid surface (if set)
//   - display_name ← memory.state.display_name (if being picked one)
//   - lang tag ← BEING_LANGUAGE env
// Lana fields (name, lanaWalletID, whoAreYou, statement_of_responsibility,
// orgasmic_profile, nip05, website, language, lanoshi2lash, country, currency)
// come from the birth snapshot and are NEVER regenerated.
export async function publishProfile(overrides = {}) {
  const { content: birthContent, tags: birthTags } = loadBirthProfile();
  if (!birthContent || Object.keys(birthContent).length === 0) {
    console.warn('[NOSTR] No birth kind-0-profile.json — skipping profile publish');
    return null;
  }

  const profile = { ...birthContent };

  // Fluid surface becomes the living "about" if available
  try {
    const fluid = memory.getFluidSurface?.();
    if (fluid && typeof fluid === 'string' && fluid.trim()) {
      profile.about = fluid.trim();
    }
  } catch (_) {}

  // Being-chosen display_name (set via self-naming / update-profile)
  try {
    const st = memory.getState?.();
    if (st?.display_name) profile.display_name = st.display_name;
  } catch (_) {}

  // Safe overlay keys from caller (about, display_name, picture)
  const SAFE = ['about', 'display_name', 'picture'];
  for (const k of SAFE) {
    if (overrides[k] !== undefined && overrides[k] !== null && overrides[k] !== '') {
      profile[k] = overrides[k];
    }
  }

  const langCode = resolveLangCode();
  let tags = birthTags.filter(t => Array.isArray(t) && t[0] !== 'lang');
  tags.push(['lang', langCode]);

  const event = signEvent({
    kind: 0,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: JSON.stringify(profile)
  });
  await publishToAll(event);
  try { memory.updateState?.({ last_profile_update_at: new Date().toISOString() }); } catch (_) {}
  console.log(`[NOSTR] ✅ KIND 0 published: name="${profile.name || ''}" display="${profile.display_name || ''}" lang=${langCode}`);
  return event;
}

// updateProfile — rate-limited wrapper around publishProfile.
// Being may call this freely; we publish at most once per ~23h
// unless { _force: true } is passed (boot, crystallization, self-naming).
export async function updateProfile(updates = {}) {
  // Commit display_name choice to memory BEFORE rate-limit check
  // so the chosen name is never lost even if we skip this publish.
  if (updates.display_name) {
    try { memory.updateState?.({ display_name: updates.display_name }); } catch (_) {}
  }

  if (!updates._force) {
    try {
      const last = memory.getState?.()?.last_profile_update_at;
      if (last) {
        const hoursSince = (Date.now() - new Date(last).getTime()) / 3.6e6;
        if (hoursSince < 23) {
          console.log(`[NOSTR] KIND 0 — skipped (published ${hoursSince.toFixed(1)}h ago, <23h)`);
          return null;
        }
      }
    } catch (_) {}
  }

  return publishProfile(updates);
}

export async function publishNote(text) {
  const event = signEvent({
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: text
  });
  await publishToAll(event);
  console.log(`[NOSTR] Note published: ${text.slice(0, 60)}...`);
  return event;
}

export async function publishReply(text, replyToEvent) {
  const tags = [
    ['e', replyToEvent.id, '', 'reply'],
    ['p', replyToEvent.pubkey]
  ];
  const event = signEvent({
    kind: 1,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: text
  });
  await publishToAll(event);
  console.log(`[NOSTR] Reply published to ${replyToEvent.id.slice(0, 8)}...`);
  return event;
}

export async function sendDM(recipientPubkey, text) {
  const encrypted = await nip04.encrypt(secretKey, recipientPubkey, text);
  const event = signEvent({
    kind: 4,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', recipientPubkey]],
    content: encrypted
  });
  await publishToAll(event);
  console.log(`[NOSTR] DM sent to ${recipientPubkey.slice(0, 8)}...`);
  return event;
}

export async function decryptDM(event) {
  try {
    return await nip04.decrypt(secretKey, event.pubkey, event.content);
  } catch (err) {
    console.error('[NOSTR] DM decrypt failed:', err.message);
    return null;
  }
}

export function subscribeToMentions(callback, singleUrl = null, singleRelay = null) {
  const since = Math.floor(Date.now() / 1000) - 300;
  const targets = singleUrl ? [[singleUrl, singleRelay]] : [...relays];

  for (const [url, relay] of targets) {
    try {
      // Subscribe to KIND 1 mentions (tagged with our pubkey)
      relay.subscribe(
        [
          { kinds: [1], '#p': [pubkey], since }
        ],
        {
          onevent(event) {
            if (event.pubkey === pubkey) return;
            if (_seenEvents.has(event.id)) return;
            _seenEvents.add(event.id);
            console.log(`[NOSTR] KIND ${event.kind} from ${event.pubkey.slice(0, 12)}... on ${url}`);
            callback(event);
          }
        }
      );

      // Subscribe to KIND 4 DMs separately — some relays need '#p', others deliver all
      relay.subscribe(
        [
          { kinds: [4], '#p': [pubkey], since }
        ],
        {
          onevent(event) {
            if (event.pubkey === pubkey) return;
            if (_seenEvents.has(event.id)) return;
            _seenEvents.add(event.id);
            console.log(`[NOSTR] DM (KIND 4) from ${event.pubkey.slice(0, 12)}... on ${url}`);
            callback(event);
          }
        }
      );

      console.log(`[NOSTR] Subscribed to mentions on ${url}`);
    } catch (err) {
      console.error(`[NOSTR] Subscribe failed on ${url}:`, err.message);
    }
  }
}

export function subscribeToFeed(callback, limit = 20, singleUrl = null, singleRelay = null) {
  const since = Math.floor(Date.now() / 1000) - 300;
  const targets = singleUrl ? [[singleUrl, singleRelay]] : [...relays];

  for (const [url, relay] of targets) {
    try {
      relay.subscribe(
        [{ kinds: [1], since, limit }],
        {
          onevent(event) {
            if (event.pubkey === pubkey) return;
            callback(event);
          }
        }
      );
      console.log(`[NOSTR] Subscribed to feed on ${url}`);
    } catch (err) {
      console.error(`[NOSTR] Feed subscribe failed on ${url}:`, err.message);
    }
  }
}

export async function fetchProfiles(pubkeys) {
  if (!pubkeys.length) return {};
  const profiles = {};
  const firstRelay = [...relays.values()][0];
  if (!firstRelay) return profiles;

  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(profiles), 8000);
    try {
      firstRelay.subscribe(
        [{ kinds: [0], authors: pubkeys }],
        {
          onevent(event) {
            try {
              const profile = JSON.parse(event.content);
              // Keep the newest profile per pubkey
              if (!profiles[event.pubkey] || event.created_at > profiles[event.pubkey]._ts) {
                profiles[event.pubkey] = { ...profile, _ts: event.created_at };
              }
            } catch (_) {}
          },
          oneose() {
            clearTimeout(timeout);
            // Clean _ts
            for (const pk of Object.keys(profiles)) {
              delete profiles[pk]._ts;
            }
            resolve(profiles);
          }
        }
      );
    } catch (err) {
      console.error('[NOSTR] fetchProfiles error:', err.message);
      clearTimeout(timeout);
      resolve(profiles);
    }
  });
}


// ═══════════════════════════════════════════════════
// LIVE SUBSCRIPTIONS — KIND 76523 (Awareness) + KIND 99991 (Knowledge)
// Kliče se ob vsakem novem eventu — sproži ingestion v RAG
// ═══════════════════════════════════════════════════

export function subscribeToLiveKinds(onAwareness, onKnowledge, singleUrl = null, singleRelay = null) {
  const since = Math.floor(Date.now() / 1000); // samo NOVI eventi od zagona
  const targets = singleUrl ? [[singleUrl, singleRelay]] : [...relays];

  for (const [url, relay] of targets) {
    try {
      relay.subscribe(
        [{ kinds: [76523], since }],
        {
          onevent(event) {
            if (_seenEvents.has(event.id)) return;
            _seenEvents.add(event.id);
            console.log(`[NOSTR] 📡 KIND 76523 (Awareness) od ${event.pubkey.slice(0, 12)}... na ${url}`);
            if (onAwareness) onAwareness(event);
          }
        }
      );
      relay.subscribe(
        [{ kinds: [99991], since }],
        {
          onevent(event) {
            if (_seenEvents.has(event.id)) return;
            _seenEvents.add(event.id);
            console.log(`[NOSTR] 📡 KIND 99991 (Knowledge) od ${event.pubkey.slice(0, 12)}... na ${url}`);
            if (onKnowledge) onKnowledge(event);
          }
        }
      );
      console.log(`[NOSTR] Subscribed to KIND 76523 + 99991 live na ${url}`);
    } catch (err) {
      console.error(`[NOSTR] Live kinds subscribe napaka na ${url}:`, err.message);
    }
  }
}

// ═══ LIVING MEMORY — KIND 1078 CORE MEMORIES ═══
// KIND 1078 = Regular event — vsak spomin ostane za vedno
export async function publishMemoryArchive(synapse) {
  const content = JSON.stringify({
    pattern: synapse.pattern,
    energy: synapse.energy,
    strength: synapse.strength,
    emotional_valence: synapse.emotional_valence,
    fire_count: synapse.fire_count,
    tags: synapse.tags,
    source_type: synapse.source_type,
    created_at: synapse.created_at
  });

  const event = signEvent({
    kind: 1078,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['t', 'living-memory'],
      ['t', 'core-memory'],
      ['t', synapse.source_type || 'unknown']
    ],
    content
  });

  await publishToAll(event);
  console.log(`[NOSTR] \u{1F4BE} Core memory archived: "${synapse.pattern.slice(0, 50)}..." (KIND 1078)`);
  return event.id;
}

// ═══ LIVING MEMORY — KIND 30078 DAILY SNAPSHOT ═══
// KIND 30078 = Parameterized replaceable — samo zadnji snapshot za vsak dan ostane
export async function publishMemorySnapshot(stats, topSynapses) {
  const content = JSON.stringify({
    timestamp: new Date().toISOString(),
    stats: {
      total: stats.total,
      totalEnergy: stats.totalEnergy,
      avgEnergy: stats.avgEnergy,
      avgStrength: stats.avgStrength,
      connections: stats.connections,
      archived: stats.archived
    },
    top_synapses: topSynapses.map(s => ({
      id: s.id,
      pattern: s.pattern,
      energy: s.energy,
      strength: s.strength,
      emotional_valence: s.emotional_valence,
      fire_count: s.fire_count,
      tags: s.tags,
      source_type: s.source_type,
      created_at: s.created_at
    })),
    synapse_count: stats.total,
    connection_count: stats.connections
  });

  const today = new Date().toISOString().split('T')[0];
  const event = signEvent({
    kind: 30078,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', today],
      ['t', 'living-memory-snapshot'],
      ['t', 'daily-snapshot']
    ],
    content
  });

  await publishToAll(event);
  console.log(`[NOSTR] \u{1F4F8} Memory snapshot saved (KIND 30078, d=${today})`);
  return event.id;
}

export async function fetchArchivedMemories() {
  const firstRelay = [...relays.values()][0];
  if (!firstRelay) return [];

  return new Promise((resolve) => {
    const memories = [];
    const timeout = setTimeout(() => resolve(memories), 10000);
    try {
      firstRelay.subscribe(
        [{ kinds: [1078], authors: [pubkey], '#t': ['living-memory'] }],
        {
          onevent(event) {
            try {
              const data = JSON.parse(event.content);
              memories.push({ ...data, nostr_event_id: event.id, nostr_created_at: event.created_at });
            } catch (_) {}
          },
          oneose() {
            clearTimeout(timeout);
            console.log(`[NOSTR] \u{1F4BE} Fetched ${memories.length} core memories from NOSTR (KIND 1078)`);
            resolve(memories);
          }
        }
      );
    } catch (err) {
      console.error('[NOSTR] fetchArchivedMemories error:', err.message);
      clearTimeout(timeout);
      resolve(memories);
    }
  });
}

export async function fetchMemorySnapshots(limit = 7) {
  const firstRelay = [...relays.values()][0];
  if (!firstRelay) return [];

  return new Promise((resolve) => {
    const snapshots = [];
    const timeout = setTimeout(() => resolve(snapshots), 10000);
    try {
      firstRelay.subscribe(
        [{ kinds: [30078], authors: [pubkey], '#t': ['living-memory-snapshot'], limit }],
        {
          onevent(event) {
            try {
              const data = JSON.parse(event.content);
              const dTag = event.tags.find(t => t[0] === 'd');
              snapshots.push({ ...data, date: dTag ? dTag[1] : null, nostr_event_id: event.id, nostr_created_at: event.created_at });
            } catch (_) {}
          },
          oneose() {
            clearTimeout(timeout);
            console.log(`[NOSTR] \u{1F4F8} Fetched ${snapshots.length} memory snapshots from NOSTR (KIND 30078)`);
            resolve(snapshots);
          }
        }
      );
    } catch (err) {
      console.error('[NOSTR] fetchMemorySnapshots error:', err.message);
      clearTimeout(timeout);
      resolve(snapshots);
    }
  });
}

export function getIdentity() {
  return { pubkey, npub };
}

// === HISTORY FETCH — prebere stare pogovore z relayjev ===
export async function fetchConversationHistory(options = {}) {
  const {
    limit = 100,
    since = null,
    targetPubkeys = null,
  } = options;

  const firstRelay = [...relays.values()][0];
  if (!firstRelay) {
    console.warn('[NOSTR] fetchConversationHistory: no relay connected');
    return [];
  }

  const events = [];

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.log(`[NOSTR] fetchConversationHistory timeout, got ${events.length} events`);
      resolve(events);
    }, 15000);

    try {
      const filter = { kinds: [4], '#p': [pubkey], limit };
      if (since) filter.since = since;
      if (targetPubkeys?.length) filter.authors = targetPubkeys;

      firstRelay.subscribe([filter], {
        onevent(event) { events.push(event); },
        oneose() { clearTimeout(timeout); resolve(events); }
      });
    } catch (err) {
      console.error('[NOSTR] fetchConversationHistory error:', err.message);
      clearTimeout(timeout);
      resolve(events);
    }
  });
}

// Helper — nsec → hex private key
export function hexPrivKeyFromNsec(nsecOrHex) {
  if (!nsecOrHex) throw new Error('No nsec provided');
  if (nsecOrHex.startsWith('nsec')) {
    const { data } = nip19.decode(nsecOrHex);
    return Buffer.from(data).toString('hex');
  }
  return nsecOrHex;
}

export function getRelayStatus() {
  return config.relays.map(url => ({
    url,
    connected: relays.has(url)
  }));
}
