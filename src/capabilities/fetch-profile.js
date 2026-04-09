// ═══ SPOSOBNOST: fetch-profile ═══
// Pobere NOSTR KIND 0 profil osebe po npub ali hex pubkey.
// Takoj vgravi v known_identities in ustvari identity sinapso.

export default {
  name: 'fetch-profile',
  description: 'Poiščem NOSTR profil osebe po npub ali hex pubkey in ga shranim v spomin',
  when: 'Ko poznaš samo npub nekoga ali ko sogovornik omeni pubkey osebe ki je ne poznaš',
  conversationAllowed: true,
  heartbeatAllowed: true,
  blocking: false, // async, ne čaka odgovora

  async execute(params, context) {
    const { memory, fetchProfiles } = context;
    const { roke_target } = params;
    if (!roke_target) return { outcome: 'skipped', detail: 'brez roke_target' };

    let hexPubkey = roke_target.trim();
    if (hexPubkey.startsWith('npub1')) {
      const { nip19 } = await import('nostr-tools');
      const decoded = nip19.decode(hexPubkey);
      hexPubkey = decoded.data;
    }
    if (hexPubkey.length !== 64) throw new Error(`Neveljaven pubkey: ${hexPubkey.slice(0, 20)}`);

    const profiles = await fetchProfiles([hexPubkey]);
    const prof = profiles[hexPubkey];
    if (prof) {
      const name = prof.display_name || prof.name || prof.username || 'neznanec';
      const about = [
        prof.about?.slice(0, 200),
        prof.nip05 ? `NIP-05: ${prof.nip05}` : '',
        prof.website ? `Website: ${prof.website}` : ''
      ].filter(Boolean).join('. ');
      memory.setIdentity(hexPubkey, name, about);
      memory.addObservation(`Poiskala sem profil: ${name} (${hexPubkey.slice(0, 8)}) — ${about.slice(0, 80)}`, 'roke_fetch_profile');
      console.log(`[ROKE] fetch-profile: ✅ ${name} (${hexPubkey.slice(0, 8)})`);
      return { outcome: 'success', detail: `Profil najden: ${name}` };
    } else {
      memory.addObservation(`Profil za ${roke_target.slice(0, 20)} ni bil najden na relayu.`, 'roke_fetch_profile');
      return { outcome: 'success', detail: 'Profil ni bil najden na relayu' };
    }
  }
};
