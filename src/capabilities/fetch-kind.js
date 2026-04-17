// ═══ SPOSOBNOST: fetch-kind ═══
// Seže po živih podatkih z NOSTR relayja za specifičen KIND event.
// Shrani v knowledge/fetched/ in ustvari sinapse.

export default {
  name: 'fetch-kind',
  description: 'Poberem žive podatke z NOSTR relayja za določen KIND (npr. 38888 za Lana parametre)',
  when: 'Ko te vprašajo o Lana ekosistemu, NOSTR KIND eventih, ali hoče vedet live podatke — roke_target = KIND številka (npr. 38888 za Lana parametre, 0 za profile)',
  conversationAllowed: true,
  heartbeatAllowed: true,
  blocking: false,

  async execute(params, context) {
    const { memory, KNOWLEDGE_DIR, fs, path } = context;
    const { roke_target, roke_concept } = params;
    if (!roke_target) return { outcome: 'skipped', detail: 'brez roke_target' };

    const kindNum = String(roke_target).replace(/\D/g, '');
    if (!kindNum) return { outcome: 'skipped', detail: 'neveljaven KIND' };

    const { Relay } = await import('nostr-tools/relay');
    const relay = await Relay.connect('wss://relay.lanavault.space');
    const events = [];
    const fetchedAt = new Date().toISOString().slice(0, 16);

    await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(), 8000);
      relay.subscribe([{ kinds: [parseInt(kindNum)], limit: 10 }], {
        onevent(ev) { events.push(ev); },
        oneose() { clearTimeout(timer); resolve(); }
      });
    });
    relay.close();

    if (events.length === 0) {
      return { outcome: 'success', detail: `KIND-${kindNum}: 0 eventov` };
    }

    // Preberi opis KINDa iz knowledge
    let kindDesc = '';
    try {
      const kindsFile = path.join(KNOWLEDGE_DIR, 'core', 'lana-nostr-kinds.md');
      if (fs.existsSync(kindsFile)) {
        const kindsContent = fs.readFileSync(kindsFile, 'utf8');
        const match = kindsContent.match(new RegExp(`KIND ${kindNum}[^\\n]*`, 'i'));
        if (match) kindDesc = match[0];
      }
    } catch (_) {}

    const fetchedDir = path.join(KNOWLEDGE_DIR, 'fetched');
    fs.mkdirSync(fetchedDir, { recursive: true });
    const fetchedFile = path.join(fetchedDir, `kind-${kindNum}.md`);
    const header = `\n\n## Fetch ${fetchedAt} (${events.length} eventov)\n${kindDesc ? '_' + kindDesc + '_\n' : ''}`;
    const body = events.map(ev => {
      const content = (ev.content || '').slice(0, 200).replace(/\n/g, ' ');
      return `- pubkey:${ev.pubkey.slice(0, 12)} | ${content}`;
    }).join('\n');
    fs.appendFileSync(fetchedFile, header + body, 'utf8');

    for (const ev of events) {
      const snippet = (ev.content || JSON.stringify(ev.tags || [])).slice(0, 100).replace(/\n/g, ' ');
      memory.createSynapse(`[KIND-${kindNum}] ${snippet}`, 50, 0.3, 0, 'nostr-kind', null,
        [`kind:${kindNum}`, 'source:relay-fetch'], ev.pubkey);
    }

    memory.addObservation(`Fetchala sem KIND-${kindNum}: ${events.length} eventov`, 'roke_fetch_kind');
    console.log(`[ROKE] fetch-kind KIND-${kindNum}: ${events.length} eventov`);
    // lookupDone: true → sproži two-pass follow-up v handleMention
    // (enako kot relay-refresh: pošlje "Počakaj..." takoj, nato pravi odgovor z novimi podatki)
    return { outcome: 'success', detail: `KIND-${kindNum}: ${events.length} eventov`, lookupDone: true };
  }
};
