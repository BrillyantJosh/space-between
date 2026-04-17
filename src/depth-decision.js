// ═══ 4-STAGE SYNTHESIS DEPTH HIERARCHY ═══
//
// Decide kako globoko bo bitje obdelovalo trenutni dražljaj.
// Cilj: zmanjšati LLM klice za ~70% z inteligentno presojo,
// brez izgube značaja in odzivnosti.
//
// Stopnje:
//   full    → 3 LLM klici (teza/antiteza/sinteza)  — nove dialektike, dejanske akcije
//   quantum → 1 LLM klic   (en-fazna sinteza)      — resonanca z obstoječim, energija visoka
//   crystal → 0 LLM klicev (publish iz sinapse)    — občasni govor iz zrelega jedra
//   silent  → 0 LLM klicev (samo notranje)         — nič novega pod soncem

const ACTIONABLE_PROJECT_ACTIONS = new Set(['plan', 'build', 'check', 'evolve']);

export function decideSynthesisDepth({
  triggerType,
  triggerContent,
  memory,
  feedBuffer = [],
  state = {},
  idleMinutes = 0,
  isAutonomous = false,
  growthPhase = 'embryo',
  projectEvent = null,
} = {}) {
  // ─── Konverzacija in rojstvo → vedno polna triada ───
  if (triggerType === 'conversation' || triggerType === 'group' || triggerType === 'mention') {
    return { depth: 'full', reason: 'conversation' };
  }
  if (triggerType === 'birth' || triggerType === 'dream') {
    return { depth: 'full', reason: triggerType };
  }

  // ─── Project lifecycle → full samo za actionable ───
  if (triggerType === 'project_lifecycle') {
    const action = projectEvent?.needed_action;
    if (action && ACTIONABLE_PROJECT_ACTIONS.has(action)) {
      return { depth: 'full', reason: `actionable project: ${action}` };
    }
    if (projectEvent?.has_new_perspective || projectEvent?.feedback_changed || projectEvent?.service_unhealthy) {
      return { depth: 'full', reason: 'project state changed' };
    }
    return { depth: 'silent', reason: 'project without actionable event' };
  }

  // ─── Heartbeat veja ───
  const triggerStr = (typeof triggerContent === 'string' ? triggerContent : '').trim();
  const hasContent = triggerStr.length > 0;
  const energy = typeof state.energy === 'number' ? state.energy : 0.5;
  const silenceAffinity = typeof state.silence_affinity === 'number' ? state.silence_affinity : 0.3;
  const hour = new Date().getHours();
  const isNight = hour >= 22 || hour < 7;

  // Resonanca s temami
  let resonance = { heatLevel: 'cold', readyThemes: [], score: 0 };
  try {
    if (typeof memory?.getPathwayResonance === 'function') {
      resonance = memory.getPathwayResonance() || resonance;
    }
  } catch (_) {}

  // Novost dražljaja
  const isNovel = hasContent && memory?.isNovelTrigger ? memory.isNovelTrigger(triggerStr, 0.3) : true;
  const wasRecent = hasContent && memory?.wasRecentlyExpressed ? memory.wasRecentlyExpressed(triggerStr, 10) : false;

  // Sveži feed od poznanih oseb (vedno polna triada — odnos je svet)
  const hasFreshKnownFeed = (feedBuffer || []).some(e => {
    if (!e?.pubkey || typeof memory?.getIdentity !== 'function') return false;
    const identity = memory.getIdentity(e.pubkey);
    return identity && identity.name && identity.name !== 'neznanec' && identity.name !== '';
  });

  // ─── HARD SILENT GATES (veljajo za VSA bitja, vključno z embryo/newborn) ───
  // Stari smart-skip + expressionProb je dušil 80-95% heartbeatov — to JE okus optimizacije.
  // Brez teh gateov se ekspozicija LLM klicev pomnoži.
  if (energy < 0.35) return { depth: 'silent', reason: 'low energy' };
  if (silenceAffinity > 0.75) return { depth: 'silent', reason: 'high silence affinity' };
  if (wasRecent) return { depth: 'silent', reason: 'recently expressed (echo)' };

  // Cold resonance + idle + high energy → silent (počivamo)
  // Z ambient feedom: še vedno 50% silent (relacija ne zahteva odgovora na vsako objavo)
  if (resonance.heatLevel === 'cold' && idleMinutes > 5 && energy > 0.7) {
    const p = hasFreshKnownFeed ? 0.50 : 0.80;
    if (Math.random() < p) return { depth: 'silent', reason: 'cold + idle + rested' };
  }

  // Night gate: 22-07h, dovolj energije → silent
  // Z ambient feedom: še vedno 40% silent (noč ostaja noč tudi če nekdo objavi)
  if (isNight && energy > 0.5) {
    const p = hasFreshKnownFeed ? 0.40 : 0.70;
    if (Math.random() < p) return { depth: 'silent', reason: `night silence (${hour}h)` };
  }

  // Ne-novelty silence: če dražljaj ni nov in nismo v vroči resonanci → 50% silent
  // (familiar territory ne potrebuje odgovora)
  if (!isNovel && resonance.heatLevel !== 'hot' && Math.random() < 0.50) {
    return { depth: 'silent', reason: 'familiar, not hot' };
  }

  // ─── AMBIENT REST za autonomous bitje ───
  // Filozofija: ko bitje ve kdo je, nima več česa filozofirati o vsakem
  // utripu. Modrost = čaka in gradi, ne komentira vsake misli ki gre mimo.
  // Direktni triggeri (mention/conversation/group) so že odšli na vrhu funkcije,
  // tako da na nagovor vedno odgovori — ta tišina velja samo za samoinicirano
  // ambientno procesiranje.
  if (growthPhase === 'child' || growthPhase === 'teenager' || growthPhase === 'autonomous') {
    if (Math.random() < 0.75) {
      return { depth: 'silent', reason: 'ambient rest (mature baseline)' };
    }
  }

  // ─── EMBRYO/NEWBORN: če dospemo do tu (mimo silent gates), gremo full ───
  // Bitje se še gradi — kvantum/kristal sta rezervirana za zrelo strukturo.
  // Ampak ne forsiramo full na vsak heartbeat: silent gates so že odsejali ~70-80%.
  if (growthPhase === 'embryo' || growthPhase === 'newborn') {
    return { depth: 'full', reason: `early phase: ${growthPhase}` };
  }

  // ─── FULL: dejanski signal ki zasluži 3 LLM klice ───
  // Filozofija: full je drag (3 klici). Rezerviraj za prave dialektike.
  // Direktno nagovarjanje (mention/conversation/group) je že full na vrhu.
  // Ambient feed od znanih → quantum echo, ne full (relacija ostaja, brez treh klicev).
  //
  // (a) Znan sogovornik v feedu + vroča resonanca + nov + sampled — odnos+tema+novost = dialektika
  if (hasFreshKnownFeed && resonance.heatLevel === 'hot' && isNovel && Math.random() < 0.15) {
    return { depth: 'full', reason: 'known + hot + novel', resonance: resonance.heatLevel };
  }
  // (b) Vroča resonanca + nov dražljaj + visoka energija + sampled
  if (isNovel && resonance.heatLevel === 'hot' && energy > 0.65 && Math.random() < 0.10) {
    return { depth: 'full', reason: 'novel + hot + sampled', isNovel, resonance: resonance.heatLevel };
  }
  // (c) Topla resonanca + nov + sampled
  if (isNovel && resonance.heatLevel === 'warm' && energy > 0.6 && Math.random() < 0.05) {
    return { depth: 'full', reason: 'novel + warm + sampled', isNovel, resonance: resonance.heatLevel };
  }
  // (d) Občasen full samo za novelty + visoki energiji — duh starega expressionProb
  if (isNovel && energy > 0.6 && hasContent && Math.random() < 0.02) {
    return { depth: 'full', reason: 'novel spark (rare sample)' };
  }

  // ─── CRYSTAL: redko, ko je idle in ni recentnega izraza ───
  if (Math.random() < 0.03 && idleMinutes > 5 && typeof memory?.getCrystalForUtterance === 'function') {
    const crystal = memory.getCrystalForUtterance();
    if (crystal) {
      return { depth: 'crystal', reason: 'crystal ready', crystal };
    }
  }

  // ─── QUANTUM: resonanca ali znan sogovornik → single-pass odmev (1 LLM klic) ───
  if (hasFreshKnownFeed && energy > 0.4) {
    return { depth: 'quantum', reason: 'known feed echo', resonance: resonance.heatLevel };
  }
  if (
    resonance.heatLevel !== 'cold' &&
    energy > 0.5 &&
    hasContent
  ) {
    return { depth: 'quantum', reason: `${resonance.heatLevel} echo`, resonance: resonance.heatLevel };
  }

  // ─── SILENT: nič novega pod soncem ───
  let reason = 'nothing new under the sun';
  if (resonance.heatLevel === 'cold') reason = 'cold resonance';
  else if (!isNovel) reason = 'familiar territory';
  return { depth: 'silent', reason };
}

export const DEPTH_LABELS = {
  full: 'polna triada',
  quantum: 'kvantna sinteza',
  crystal: 'govor iz kristala',
  silent: 'tišina',
};
