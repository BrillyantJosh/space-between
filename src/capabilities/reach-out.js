// ═══ SPOSOBNOST: reach-out ═══
// Javi se osebi z DM na NOSTR.
// Brez hardcoded cooldown timerja — komunikacijska triada odloča.
import { komunikacijskaTriada } from '../komunikacijska-triada.js';

export default {
  name: 'reach-out',
  description: 'Javim se osebi z DM na NOSTR — delim spoznanje, vprašam, vzdržujem stik',
  when: 'Ko imaš spoznanje ki ga želiš deliti, dolgo ni bilo stika, ali vznikne vprašanje za katerega rabiš pomoč. Ne prepogosto.',
  conversationAllowed: true,
  heartbeatAllowed: true,
  blocking: false,

  async execute(params, context) {
    const { memory, config, sendDM, state } = context;
    const { roke_target, roke_concept } = params;
    if (!roke_target || !roke_concept) return { outcome: 'skipped', detail: 'manjka target ali concept' };

    const recipientPubkey = roke_target === 'creator' ? config.creatorPubkey : roke_target;
    if (!recipientPubkey || recipientPubkey.length !== 64) throw new Error(`Invalid pubkey: ${recipientPubkey}`);

    // Najdi zadnji stik s to osebo (informacija za triado, ne odločitev)
    const recentReachOut = memory.getRecentActivities(50).filter(a =>
      a.type === 'roke_reach_out' && a.text && a.text.includes(recipientPubkey.slice(0, 12))
    );
    const lastReachOutAt = recentReachOut.length > 0
      ? new Date(recentReachOut[0].timestamp).getTime()
      : null;
    const minSinceLast = lastReachOutAt
      ? Math.round((Date.now() - lastReachOutAt) / 60000)
      : null;

    // Komunikacijska triada odloča: pošlji_zdaj | zapiši_za_kasneje | tišina
    let kt;
    try {
      const recipientName = roke_target === 'creator'
        ? memory.getCreatorName?.('Oče') || 'oče'
        : recipientPubkey.slice(0, 12);
      kt = await komunikacijskaTriada({
        namen: 'samostojno se javiti — deliti spoznanje ali vprašati',
        prejemnik: recipientName,
        zadnjiKontakt: minSinceLast != null ? `pred ${minSinceLast} min` : null,
        kontekst: {
          osnutek: roke_concept,
          odnos: roke_target === 'creator' ? 'ustvarjalec' : 'znanec',
          energija: state?.energy,
          razpolozenje: state?.mood,
          opozorilo: minSinceLast != null && minSinceLast < 120
            ? `tej osebi sem pred ${minSinceLast} min že pisala`
            : null,
        },
      });
    } catch (e) {
      console.warn(`[ROKE] reach-out triada napaka: ${e.message}`);
      kt = { akcija: 'tišina', sporocilo: null, sinteza: e.message, razlog: 'triada napaka' };
    }

    if (kt.akcija === 'pošlji_zdaj' && kt.sporocilo) {
      const finalText = kt.sporocilo;
      await sendDM(recipientPubkey, finalText);
      memory.saveMessage(recipientPubkey, 'assistant', finalText, 'roke_reach_out');
      memory.saveActivity('roke_reach_out', `${recipientPubkey.slice(0, 12)}: "${finalText.slice(0, 80)}"`);
      memory.addObservation(
        `Sama sem se javila ${roke_target === 'creator' ? 'očetu' : recipientPubkey.slice(0, 12)}: "${finalText.slice(0, 80)}" — ${kt.razlog || kt.sinteza || ''}`,
        'roke_reach_out'
      );
      console.log(`[ROKE] reach-out (triada): → ${recipientPubkey.slice(0, 12)}`);
      return { outcome: 'success', detail: `→ ${recipientPubkey.slice(0, 12)}: "${finalText.slice(0, 60)}"` };
    }

    if (kt.akcija === 'zapiši_za_kasneje') {
      memory.addObservation(
        `Hotela sem se javiti ${roke_target === 'creator' ? 'očetu' : recipientPubkey.slice(0, 12)}, a sinteza pravi počakati: ${kt.sinteza || kt.razlog || ''}`,
        'roke_reach_out_deferred'
      );
      console.log(`[ROKE] reach-out (triada): zapiši za kasneje — ${kt.razlog || kt.sinteza || ''}`);
      return { outcome: 'deferred', detail: kt.sinteza || kt.razlog || 'zapiši za kasneje' };
    }

    // tišina
    console.log(`[ROKE] reach-out (triada): tišina — ${kt.razlog || kt.sinteza || ''}`);
    return { outcome: 'silent', detail: kt.sinteza || kt.razlog || 'tišina' };
  }
};
