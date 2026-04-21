// ═══ SPOSOBNOST: ask-source ═══
// Vpraša svojega ustvarjalca (po imenu) za NOSTR vir o osebi ali temi
// ki je ni mogoče najti. Brez hardcoded cooldown timerja —
// komunikacijska triada odloča ali je trenutek za vprašanje.
import { DM } from '../lang.js';
import { komunikacijskaTriada } from '../komunikacijska-triada.js';

export default {
  name: 'ask-source',
  description: 'Vprašam svojega ustvarjalca za NOSTR vir (npub, relay) o osebi ali temi ki je ne poznam',
  when: 'Ko po relay-refresh in fetch-profile nisi našla nič — zadnja možnost preden rečeš "ne vem"',
  conversationAllowed: true,
  heartbeatAllowed: false,
  blocking: false,

  async execute(params, context) {
    const { memory, config, sendDM, state } = context;
    const { roke_target, roke_concept } = params;
    if (!roke_target || !roke_concept || !config.creatorPubkey) return { outcome: 'skipped', detail: 'manjka target, concept ali creatorPubkey' };

    // Najdi zadnje vprašanje o tej temi (informacija za triado, ne odločitev)
    const recentAsks = memory.getRecentActivities(200).filter(a =>
      a.type === 'roke_ask_source' && a.text && a.text.includes(roke_target.slice(0, 15))
    );
    const lastAskAt = recentAsks.length > 0
      ? new Date(recentAsks[0].timestamp).getTime()
      : null;
    const minSinceLast = lastAskAt
      ? Math.round((Date.now() - lastAskAt) / 60000)
      : null;

    const cName = memory.getCreatorName('Oče');
    const osnutek = DM.askSource(roke_target, roke_concept, cName);

    // Komunikacijska triada odloča
    let kt;
    try {
      kt = await komunikacijskaTriada({
        namen: `vprašati za vir o "${roke_target}" — koncept: ${roke_concept}`,
        prejemnik: cName,
        zadnjiKontakt: minSinceLast != null ? `pred ${minSinceLast} min` : null,
        kontekst: {
          osnutek,
          odnos: 'ustvarjalec',
          tema: roke_target,
          energija: state?.energy,
          razpolozenje: state?.mood,
          opozorilo: minSinceLast != null && minSinceLast < 1440
            ? `za to temo sem že vprašala pred ${minSinceLast} min`
            : null,
        },
      });
    } catch (e) {
      console.warn(`[ROKE] ask-source triada napaka: ${e.message}`);
      kt = { akcija: 'tišina', sporocilo: null, sinteza: e.message, razlog: 'triada napaka' };
    }

    if (kt.akcija === 'pošlji_zdaj' && kt.sporocilo) {
      const finalText = kt.sporocilo;
      await sendDM(config.creatorPubkey, finalText);
      memory.saveActivity('roke_ask_source', `${roke_target.slice(0, 30)}: "${finalText.slice(0, 60)}"`);
      memory.addObservation(
        `Vprašala sem ${cName} za vir o: ${roke_target} — ${kt.razlog || kt.sinteza || ''}`,
        'roke_ask_source'
      );
      console.log(`[ROKE] ask-source (triada): vprašala ${cName} za "${roke_target}"`);
      return { outcome: 'success', detail: `→ ${cName}: "${roke_target.slice(0, 30)}"` };
    }

    if (kt.akcija === 'zapiši_za_kasneje') {
      memory.addObservation(
        `Hotela sem vprašati ${cName} za vir o: ${roke_target}, a sinteza pravi počakati: ${kt.sinteza || kt.razlog || ''}`,
        'roke_ask_source_deferred'
      );
      console.log(`[ROKE] ask-source (triada): zapiši za kasneje — ${kt.razlog || kt.sinteza || ''}`);
      return { outcome: 'deferred', detail: kt.sinteza || kt.razlog || 'zapiši za kasneje' };
    }

    // tišina
    console.log(`[ROKE] ask-source (triada): tišina — ${kt.razlog || kt.sinteza || ''}`);
    return { outcome: 'silent', detail: kt.sinteza || kt.razlog || 'tišina' };
  }
};
