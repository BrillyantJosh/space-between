// ═══ SPOSOBNOST: relay-refresh ═══
// Seže po starih pogovorih z NOSTR relayjev in jih vgradi v spomin.
// Blocking za conversation — čaka rezultate preden se pošlje follow-up odgovor.

export default {
  name: 'relay-refresh',
  description: 'Poberem stare pogovore z NOSTR relayjev in jih vgradim v spomin',
  when: 'Ko te vprašajo o osebi ki je ne spomniš dobro, o preteklem pogovoru, o nekom tretjem — NAJPREJ to, ne odgovarjaj z "ne vem"',
  conversationAllowed: true,
  heartbeatAllowed: true,
  blocking: true, // v conversation awaita rezultat → trigger za follow-up odgovor
  pauseMessage: 'Počakaj trenutek, pobrskam po svojem spominu...', // default če LLM ne nastavi content

  async execute(params, context) {
    const { memory, refreshMemoryFromRelay } = context;
    const result = await refreshMemoryFromRelay({ limit: 50, days: 60 });
    memory.addObservation(
      `Osvežila sem spomin z relayjev: ${result.processed} sporočil, ${result.synapses} novih sinaps`,
      'roke_relay_refresh'
    );
    console.log(`[ROKE] relay-refresh: ${result.processed} sporočil, ${result.synapses} sinaps`);
    return { lookupDone: true, processed: result.processed, synapses: result.synapses };
  }
};
