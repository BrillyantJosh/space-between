// ═══ SPOSOBNOST: ask-source ═══
// Vpraša svojega ustvarjalca (po imenu) za NOSTR vir o osebi ali temi
// ki je ni mogoče najti. Cooldown 24h per tema da ne zasiplje.
import { DM } from '../lang.js';

export default {
  name: 'ask-source',
  description: 'Vprašam svojega ustvarjalca za NOSTR vir (npub, relay) o osebi ali temi ki je ne poznam',
  when: 'Ko po relay-refresh in fetch-profile nisi našla nič — zadnja možnost preden rečeš "ne vem"',
  conversationAllowed: true,
  heartbeatAllowed: false,
  blocking: false,

  async execute(params, context) {
    const { memory, config, sendDM } = context;
    const { roke_target, roke_concept } = params;
    if (!roke_target || !roke_concept || !config.creatorPubkey) return { outcome: 'skipped', detail: 'manjka target, concept ali creatorPubkey' };

    // Cooldown 24h per tema
    const recentAsks = memory.getRecentActivities(200).filter(a =>
      a.type === 'roke_ask_source' && a.text && a.text.includes(roke_target.slice(0, 15))
    );
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const alreadyAsked = recentAsks.some(a => new Date(a.timestamp).getTime() > dayAgo);

    if (alreadyAsked) {
      console.log(`[ROKE] ask-source preskočen — že vprašano za "${roke_target}" v zadnjih 24h`);
      return { outcome: 'skipped', detail: 'cooldown: že vprašano za to temo' };
    }

    const cName = memory.getCreatorName('Oče');
    const msg = DM.askSource(roke_target, roke_concept, cName);
    await sendDM(config.creatorPubkey, msg);
    memory.saveActivity('roke_ask_source', `${roke_target.slice(0, 30)}: "${roke_concept.slice(0, 60)}"`);
    memory.addObservation(`Vprašala sem ${cName} za vir o: ${roke_target}`, 'roke_ask_source');
    console.log(`[ROKE] ask-source: vprašala ${cName} za "${roke_target}"`);
    return { outcome: 'success', detail: `→ ${cName}: "${roke_target.slice(0, 30)}"` };
  }
};
