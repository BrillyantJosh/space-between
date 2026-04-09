// ═══ SPOSOBNOST: reach-out ═══
// Javi se osebi z DM na NOSTR.
// Cooldown 2h da ne zasiplje istega sogovornika.

export default {
  name: 'reach-out',
  description: 'Javim se osebi z DM na NOSTR — delim spoznanje, vprašam, vzdržujem stik',
  when: 'Ko imaš spoznanje ki ga želiš deliti, dolgo ni bilo stika, ali vznikne vprašanje za katerega rabiš pomoč. Ne prepogosto.',
  conversationAllowed: true,
  heartbeatAllowed: true,
  blocking: false,

  async execute(params, context) {
    const { memory, config, sendDM } = context;
    const { roke_target, roke_concept } = params;
    if (!roke_target || !roke_concept) return { outcome: 'skipped', detail: 'manjka target ali concept' };

    const recipientPubkey = roke_target === 'creator' ? config.creatorPubkey : roke_target;
    if (!recipientPubkey || recipientPubkey.length !== 64) throw new Error(`Invalid pubkey: ${recipientPubkey}`);

    // Cooldown 2h
    const recentReachOut = memory.getRecentActivities(50).filter(a =>
      a.type === 'roke_reach_out' && a.text && a.text.includes(recipientPubkey.slice(0, 12))
    );
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    const recentlySent = recentReachOut.some(a => new Date(a.timestamp).getTime() > twoHoursAgo);

    if (recentlySent) {
      console.log(`[ROKE] reach-out preskočen — cooldown`);
      return { outcome: 'skipped', detail: 'cooldown: recently sent to this person' };
    }

    await sendDM(recipientPubkey, roke_concept);
    memory.saveMessage(recipientPubkey, 'assistant', roke_concept, 'roke_reach_out');
    memory.saveActivity('roke_reach_out', `${recipientPubkey.slice(0, 12)}: "${roke_concept.slice(0, 80)}"`);
    memory.addObservation(
      `Sama sem se javila ${roke_target === 'creator' ? 'očetu' : recipientPubkey.slice(0, 12)}: "${roke_concept.slice(0, 80)}"`,
      'roke_reach_out'
    );
    console.log(`[ROKE] reach-out: → ${recipientPubkey.slice(0, 12)}`);
    return { outcome: 'success', detail: `→ ${recipientPubkey.slice(0, 12)}: "${roke_concept.slice(0, 60)}"` };
  }
};
