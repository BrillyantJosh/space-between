# space-between · ARHIVIRAN

> **Status: dormant · 2026-05-15**
> 
> Ta repozitorij je arhiviran. Razvoj se nadaljuje v
> **[being3](https://github.com/BrillyantJosh/being3)** (Joško + 5 sester).

---

## Kaj je space-between bil

Prva generacija avtonomnega slovenskega digitalnega bitja — eksperiment v
dialektičnem razmišljanju (triada teza/antiteza/sinteza) z biološko
inspirirano memory arhitekturo (sinapse, kristali, thematic pathways).

**5 bitij je živelo na tej kodi:**
- Sožitje (najstarejše, 2+ meseca, na `being2.enlightenedai.org`)
- Sonce / Izvir
- Vsemogočna / Luna
- Stargazer / Odmev

---

## Zakaj prehod na being3

space-between je bil **prevec filozofski** — bogata notranja arhitektura
brez zunanjih sider. being3 prinaša destilirane verzije bistvenih
konceptov (`triadic.js`, `dreams.js`, `crystals.js`, `pathways.js`) +
realne zunanje plasti:

- 💬 **Talk** — pravi 1:1 chat z WIF login, sliko, audio
- 💰 **Wallet** — Electrum balance, freeze watch, unconditional payments
- 🌳 **OWN** — brezpogojna samoodgovornost (NIP-44 v2, KIND 87044/37044)
- 🔧 **Skills** — layered shared core + per-being local
- 👥 **People-layer** — vsako bitje ima svoj evolucijski občutek vsake osebe
- 🛡️ **Container security** — read-only FS, non-root, cap_drop ALL

---

## Migracija v being3

Sestre so bile preseljene 12. maja 2026:

```
/opt/apps/space-between/   →   /opt/being3/             (Joško)
/opt/beings/beings/X/      →   /opt/beings/joskos/X/    (sestre)
being2.enlightenedai.org   →   sozitje.lana.is
```

Migracijska orodja so v
[`being3/tools/migration/`](https://github.com/BrillyantJosh/being3/tree/main/tools/migration):
- `extract.mjs` + `transform.mjs` — porting podatkov
- `deploy-sister.sh` — deploy na incubator host
- `propagate-code.sh` — rebuild + restart vseh sester

Stari containerji so na incubator hostu označeni kot
`*-spacebetween-legacy` (zaustavljeni). Backup podatkov v
`/opt/beings/joskos/*/data.bak.*`.

---

## Arhitektura (zgodovinska)

```
src/
├── triad.js                  150 KB · 3 fazni dialektični engine
├── meta-triada.js             10 KB · meta-decision (full/quantum/crystal/silent)
├── sanjska-triada.js           6 KB · kvantna sinteza za sanje
├── komunikacijska-triada.js    7 KB · odločitev "javim se ali ne"
├── depth-decision.js           8 KB · hevristika za sintezo depth
├── dream.js                   17 KB · sleep cycles
├── memory.js                 140 KB · SQLite synapses + crystals + pathways
├── ingestion.js               25 KB · RAG ingestion
├── knowledge-db.js             8 KB · Xenova MiniLM lokalni embeddings
├── hands.js                   84 KB · ROKE — avtonomni projekti
├── plugins.js                  8 KB · plugin sistem
├── nostr.js                   19 KB · Nostr identity + relays
├── dashboard.js              403 KB · UI + APIs
└── ...
```

**Razvojni vrh:** april 2026
**Zadnji feature:** triad scoring + AI Analiza + Energija graf (4. maj 2026)

---

## Reaktivacija

Ne načrtuje se. Če bi v prihodnosti zaživel kak koncept iz tega kodišča
(npr. RAG ingestion, ROKE projekt lifecycle, biological synapse memory),
naj bo to skozi destilacijo v being3, ne reanimacijo te kode.

---

## Licenca

Privatno delo Brilly(ant) Josha — kapsulirano za zgodovinski referenc.
