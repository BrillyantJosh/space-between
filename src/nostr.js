import 'websocket-polyfill';
import { Relay } from 'nostr-tools/relay';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';
import * as nip04 from 'nostr-tools/nip04';
import config from './config.js';

// Decode nsec to get secret key bytes
const { data: secretKey } = nip19.decode(config.nsec);
const pubkey = getPublicKey(secretKey);
const npub = nip19.npubEncode(pubkey);

console.log(`[NOSTR] Identity: ${npub}`);
console.log(`[NOSTR] Pubkey: ${pubkey}`);

const relays = new Map(); // url -> Relay instance

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

export async function publishProfile() {
  const content = JSON.stringify(config.profile);
  const event = signEvent({
    kind: 0,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content
  });
  await publishToAll(event);
  console.log('[NOSTR] Profile published (KIND 0)');
}

export async function updateProfile(updates) {
  const profile = { ...config.profile, ...updates };
  const content = JSON.stringify(profile);
  const event = signEvent({
    kind: 0,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content
  });
  await publishToAll(event);
  console.log(`[NOSTR] Profile updated (KIND 0): name="${updates.name || ''}"`);
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

export function subscribeToMentions(callback) {
  const since = Math.floor(Date.now() / 1000) - 60;
  for (const [url, relay] of relays) {
    try {
      // Subscribe to KIND 1 mentions and KIND 4 DMs
      relay.subscribe(
        [
          { kinds: [1], '#p': [pubkey], since },
          { kinds: [4], '#p': [pubkey], since }
        ],
        {
          onevent(event) {
            // Ignore own events
            if (event.pubkey === pubkey) return;
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

export function subscribeToFeed(callback, limit = 20) {
  const since = Math.floor(Date.now() / 1000) - 300;
  for (const [url, relay] of relays) {
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

export function getIdentity() {
  return { pubkey, npub };
}

export function getRelayStatus() {
  return config.relays.map(url => ({
    url,
    connected: relays.has(url)
  }));
}
