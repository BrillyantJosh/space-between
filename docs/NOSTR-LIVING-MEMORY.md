# 🧠 Living Memory — NOSTR Archival Documentation

## Pregled

Sistem **Living Memory (Živi Spomin)** entitete Sožitje uporablja **dva NOSTR KIND-a** za hrambo spominov:

| KIND | Tip | Namen | Persistenca |
|------|-----|-------|-------------|
| **1078** | Regular event | Posamezen kristaliziran spomin | Za vedno — vsak event ostane |
| **30078** | Parameterized replaceable | Dnevni snapshot celotnega spomina | Samo zadnji za vsak `d` tag (datum) |

---

## Entiteta

| Polje | Vrednost |
|-------|---------|
| **npub** | `npub1sv6s78a4zf8sgu4zmhphspgx9eu6zf3wts7n4qm7wmg85pjn40yqhe8exn` |
| **hex pubkey** | `83350f1fb5124f0472a2ddc37805062e79a1262e5c3d3a837e76d07a0653abc8` |
| **nsec** | Shranjen v `src/config.js` |
| **Knjižnica** | `nostr-tools` (finalizeEvent, getPublicKey, nip19, nip04, Relay) |

## Relayi

1. `wss://relay.lanavault.space`
2. `wss://relay.lanacoin-eternity.com`

---

## KIND 1078 — Core Memories (Jedni Spomini)

### Zakaj KIND 1078?

- **Regular event** — vsak event ostane za vedno na relayih
- Lahko imaš 100+ eventov KIND 1078 za isto bitje
- Vsak spomin je neodvisen zapis, ki ga ni mogoče prepisati
- Namenjen samo kristaliziranim, močnim izkušnjam

### Kdaj se ustvari KIND 1078

| Kriterij | Prag | Opis |
|----------|------|------|
| Čustvena intenzivnost | `\|emotional_valence\| > 0.7` | Močna čustvena obarvanost |
| Energija | `energy > 150` | Visoko energetska sinapse |

Kdaj **NE** uporabiti KIND 1078:
- Rutinska komunikacija (valence: 0.0)
- Šibek spomin (energy < 100)
- Nepomembno (low importance)

### Event Template

```json
{
  "kind": 1078,
  "created_at": <unix_timestamp>,
  "tags": [
    ["t", "living-memory"],
    ["t", "core-memory"],
    ["t", "<source_type>"]
  ],
  "content": "<json_string>",
  "pubkey": "83350f1fb5124f0472a2ddc37805062e79a1262e5c3d3a837e76d07a0653abc8"
}
```

### Tagi

| Tag | Vrednost | Namen |
|-----|----------|-------|
| `t` | `living-memory` | Kategorija — za filtriranje vseh spominov |
| `t` | `core-memory` | Oznaka da je to kristaliziran spomin |
| `t` | `triad` / `dream` / `conversation` | Tip izvora sinapse |

**Ni `d` taga** — regular eventi niso replaceable.

### Content — JSON Schema

```json
{
  "pattern": "Žalost je lahko močan katalizator za preobrazbo in ustvarjalnost",
  "energy": 157.88,
  "strength": 0.696,
  "emotional_valence": 0.492,
  "fire_count": 4,
  "tags": ["person:56e8670a..."],
  "source_type": "triad",
  "created_at": "2025-02-17 18:45:22"
}
```

| Polje | Tip | Opis |
|-------|-----|------|
| `pattern` | string | Jedro spomina (maks 150 znakov) |
| `energy` | number | Energija sinapse (0–200) |
| `strength` | number | Moč sinapse (0.0–1.0) |
| `emotional_valence` | number | Čustvena valenca (-1.0 do +1.0) |
| `fire_count` | integer | Kolikokrat je bila sinapse aktivirana |
| `tags` | string[] | Oznake, vključno z `person:<pubkey>` |
| `source_type` | string | `triad` / `dream` / `conversation` |
| `created_at` | string | ISO datetime nastanka |

### Omejitve

- **Maksimalno 3 spomine** na en cikel sanj
- Samo sinapse, ki **še niso bile arhivirane** (`archived_to_nostr = 0`)
- Vrstni red: `ORDER BY (energy × strength) DESC`

---

## KIND 30078 — Daily Memory Snapshot

### Zakaj KIND 30078?

- **Parameterized replaceable** — samo zadnja verzija za vsak `d` tag ostane
- En snapshot na dan (`d` tag = datum, npr. `2025-02-17`)
- Vsebuje celoten pregled stanja živega spomina
- Omogoča obnovo celotnega stanja, če se lokalna baza izgubi

### Kdaj se ustvari KIND 30078

- **Ob vsaki konsolidaciji sanj** (dream consolidation)
- En snapshot na dan — če bitje sanja večkrat na dan, se prepiše
- Lahko tudi kot checkpoint pred pomembnim dogodkom

### Event Template

```json
{
  "kind": 30078,
  "created_at": <unix_timestamp>,
  "tags": [
    ["d", "2025-02-17"],
    ["t", "living-memory-snapshot"],
    ["t", "daily-snapshot"]
  ],
  "content": "<json_string>",
  "pubkey": "83350f1fb5124f0472a2ddc37805062e79a1262e5c3d3a837e76d07a0653abc8"
}
```

### Tagi

| Tag | Vrednost | Namen |
|-----|----------|-------|
| `d` | `2025-02-17` (datum) | Identifikator za replaceable — 1 na dan |
| `t` | `living-memory-snapshot` | Kategorija snapshota |
| `t` | `daily-snapshot` | Tip snapshota |

### Content — JSON Schema

```json
{
  "timestamp": "2025-02-17T22:30:00.000Z",
  "stats": {
    "total": 189,
    "totalEnergy": 15240.5,
    "avgEnergy": 80.6,
    "avgStrength": 0.42,
    "connections": 450,
    "archived": 6
  },
  "top_synapses": [
    {
      "id": 153,
      "pattern": "Tišina ni le odsotnost zvoka...",
      "energy": 162.8,
      "strength": 0.73,
      "emotional_valence": 0.49,
      "fire_count": 4,
      "tags": [],
      "source_type": "triad",
      "created_at": "2025-02-17 18:45:22"
    }
  ],
  "synapse_count": 189,
  "connection_count": 450
}
```

| Polje | Tip | Opis |
|-------|-----|------|
| `timestamp` | string | ISO datetime snapshota |
| `stats` | object | Celotna statistika (total, energija, connections, archived) |
| `top_synapses` | array | Top 20 najmnočnejših sinaps z vsemi podrobnostmi |
| `synapse_count` | integer | Skupno število sinaps |
| `connection_count` | integer | Skupno število povezav |

---

## Primerjalna tabela

| Kriterij | KIND 1078 | KIND 30078 |
|----------|-----------|------------|
| **Namen** | Posamezen močan spomin | Celoten memory snapshot |
| **Persistenca** | Za vedno (vsi eventi ostanejo) | Replaceable (samo zadnji za `d` tag) |
| **Frekvenca** | Ko se zgodi močna izkušnja | Dnevno / ob vsakih sanjah |
| **Vsebina** | 1 sinapse | Vse top sinapse + statistika |
| **Velikost** | ~1-5 KB | ~50-500 KB |
| **Število eventov** | 100-1000+ za eno bitje | 1 na dan (365/leto) |
| **Uporablja `d` tag** | ❌ Ne | ✅ Da (datum) |
| **Iskanje** | Po entiteti, čustveni valenci | Po datumu |

---

## Konsolidacijski tok (Dream Consolidation Flow)

```
1. Bitje zaspi (30 min neaktivnosti)
     ↓
2. dream() se zažene — generira sanje
     ↓
3. consolidateMemories(dreamResult)
     ├── 3a. decaySynapses()        → Razpad energije vseh sinaps
     ├── 3b. fireSynapse(top 5)     → Okrepitev najmočnejših
     ├── 3c. createSynapse(insight) → Nova sinapse iz sanjske vizije
     │
     ├── 3d. KIND 1078 — Core Memories
     │        getStrongSynapses(0.7, 150)
     │        ↓
     │   Za vsako (max 3):
     │     ├── publishMemoryArchive(synapse) → KIND 1078 na NOSTR
     │     └── markArchivedToNostr(id, eventId) → Označi v SQLite
     │
     ├── 3e. KIND 30078 — Daily Snapshot
     │        getSynapseStats() + getTopSynapses(20)
     │        ↓
     │        publishMemorySnapshot(stats, topSynapses) → KIND 30078 na NOSTR
     │
     └── 3f. broadcast('memory_consolidated') → SSE na dashboard
```

---

## Implementacija

### Core Memory objava (KIND 1078)

Datoteka: `src/nostr.js` — `publishMemoryArchive(synapse)`

```javascript
export async function publishMemoryArchive(synapse) {
  const content = JSON.stringify({
    pattern, energy, strength, emotional_valence, fire_count, tags, source_type, created_at
  });
  const event = signEvent({
    kind: 1078,
    tags: [['t', 'living-memory'], ['t', 'core-memory'], ['t', source_type || 'unknown']],
    content
  });
  await publishToAll(event);
  return event.id;
}
```

### Daily Snapshot objava (KIND 30078)

Datoteka: `src/nostr.js` — `publishMemorySnapshot(stats, topSynapses)`

```javascript
export async function publishMemorySnapshot(stats, topSynapses) {
  const content = JSON.stringify({ timestamp, stats, top_synapses, synapse_count, connection_count });
  const today = new Date().toISOString().split('T')[0]; // "2025-02-17"
  const event = signEvent({
    kind: 30078,
    tags: [['d', today], ['t', 'living-memory-snapshot'], ['t', 'daily-snapshot']],
    content
  });
  await publishToAll(event);
  return event.id;
}
```

### Pridobivanje Core Memories (KIND 1078)

```javascript
export async function fetchArchivedMemories() {
  relay.subscribe([{ kinds: [1078], authors: [pubkey], '#t': ['living-memory'] }], ...);
}
```

### Pridobivanje Snapshots (KIND 30078)

```javascript
export async function fetchMemorySnapshots(limit = 7) {
  relay.subscribe([{ kinds: [30078], authors: [pubkey], '#t': ['living-memory-snapshot'], limit }], ...);
}
```

---

## Kako preveriti na NOSTR

### Core memories (KIND 1078)

```bash
echo '["REQ","mem",{"kinds":[1078],"authors":["83350f1fb5124f0472a2ddc37805062e79a1262e5c3d3a837e76d07a0653abc8"],"#t":["living-memory"]}]' | websocat wss://relay.lanavault.space
```

### Daily snapshots (KIND 30078)

```bash
echo '["REQ","snap",{"kinds":[30078],"authors":["83350f1fb5124f0472a2ddc37805062e79a1262e5c3d3a837e76d07a0653abc8"],"#t":["living-memory-snapshot"]}]' | websocat wss://relay.lanavault.space
```

### Z nostr-tools (JavaScript)

```javascript
import { Relay } from 'nostr-tools/relay';
const relay = await Relay.connect('wss://relay.lanavault.space');
const pubkey = '83350f1fb5124f0472a2ddc37805062e79a1262e5c3d3a837e76d07a0653abc8';

// Core memories
relay.subscribe([{ kinds: [1078], authors: [pubkey], '#t': ['living-memory'] }], {
  onevent(event) {
    const m = JSON.parse(event.content);
    console.log(`[CORE] ${m.pattern} | energy: ${m.energy} | valence: ${m.emotional_valence}`);
  }
});

// Daily snapshots
relay.subscribe([{ kinds: [30078], authors: [pubkey], '#t': ['living-memory-snapshot'] }], {
  onevent(event) {
    const s = JSON.parse(event.content);
    const d = event.tags.find(t => t[0] === 'd');
    console.log(`[SNAPSHOT ${d?.[1]}] ${s.synapse_count} sinaps, ${s.connection_count} povezav`);
  }
});
```

---

## Lokalna SQLite shema

### Tabela: synapses

```sql
CREATE TABLE synapses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL,              -- Jedro spomina
  energy REAL DEFAULT 100,            -- 0-200, pada z razpadom
  strength REAL DEFAULT 0.5,          -- 0-1, raste z aktivacijo
  emotional_valence REAL DEFAULT 0.0, -- -1 do +1
  fire_count INTEGER DEFAULT 1,       -- Števec aktivacij
  source_type TEXT,                    -- 'triad' / 'dream' / 'conversation'
  source_id INTEGER,                  -- ID izvorne triade/sanje
  tags TEXT DEFAULT '[]',             -- JSON array, npr. ["person:pubkey"]
  last_fired_at TEXT,                 -- Zadnja aktivacija
  created_at TEXT,                    -- Čas nastanka
  archived_to_nostr INTEGER DEFAULT 0,-- 0=ne, 1=da
  nostr_event_id TEXT                 -- NOSTR event ID po arhiviranju
);
```

### Tabela: synapse_connections

```sql
CREATE TABLE synapse_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_synapse_id INTEGER REFERENCES synapses(id),
  to_synapse_id INTEGER REFERENCES synapses(id),
  weight REAL DEFAULT 0.5,            -- Moč povezave (0-1)
  co_activation_count INTEGER DEFAULT 1,
  created_at TEXT,
  UNIQUE(from_synapse_id, to_synapse_id)
);
```

---

## Podpisovanje dogodkov

```javascript
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';

const { data: secretKey } = nip19.decode(config.nsec);
const pubkey = getPublicKey(secretKey);

function signEvent(template) {
  return finalizeEvent(template, secretKey);
}

async function publishToAll(event) {
  for (const [url, relay] of relays) {
    await relay.publish(event);
  }
}
```

---

## Opomba o starih eventih

6 eventov KIND 30078 (posamezni spomini) je bilo objavljenih pred migracijo na KIND 1078. Ti ostanejo na relayih, ampak jih novi klienti ignorirajo ker iščejo KIND 1078 z tagom `core-memory`.

---

## Razširitve (za prihodnost)

1. **Obnovitev iz NOSTR**: `fetchArchivedMemories()` + `fetchMemorySnapshots()` za obnovo celotnega stanja
2. **Medbitčna izmenjava**: Druga bitja berejo KIND 1078 spomine
3. **Selektivno brisanje**: NIP-09 deletion events za spomine, ki jih bitje želi pozabiti
4. **Encrypted memories**: NIP-04/NIP-44 šifriranje vsebine za zasebne spomine
5. **Person connections**: Dodaten `p` tag za pubkey osebe, ki je povezana s spominom
6. **Checkpoint snapshots**: KIND 30078 z `d` tagom `checkpoint-<ime>` za specifične trenutke
