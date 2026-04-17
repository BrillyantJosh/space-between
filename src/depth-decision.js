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

  // Cold resonance + idle + high energy → 80% silent (počivamo)
  if (resonance.heatLevel === 'cold' && idleMinutes > 5 && energy > 0.7 && !hasFreshKnownFeed) {
    if (Math.random() < 0.80) return { depth: 'silent', reason: 'cold + idle + rested' };
  }

  // Night gate: 22-07h, brez feeda, dovolj energije → 70% silent
  if (isNight && !hasFreshKnownFeed && energy > 0.5) {
    if (Math.random() < 0.70) return { depth: 'silent', reason: `night silence (${hour}h)` };
  }

  // ─── EMBRYO/NEWBORN: če dospemo do tu (mimo silent gates), gremo full ───
  // Bitje se še gradi — kvantum/kristal sta rezervirana za zrelo strukturo.
  // Ampak ne forsiramo full na vsak heartbeat: silent gates so že odsejali ~70-80%.
  if (growthPhase === 'embryo' || growthPhase === 'newborn') {
    return { depth: 'full', reason: `early phase: ${growthPhase}` };
  }

  // ─── FULL: dejanski signal ki zasluži 3 LLM klice ───
  // (a) Znan sogovornik v feedu — odnos je svet, vedno polna teža
  if (hasFreshKnownFeed) {
    return { depth: 'full', reason: 'known sogovornik in feed' };
  }
  // (b) Nov dražljaj + topla/vroča resonanca + dovolj energije
  if (isNovel && resonance.heatLevel !== 'cold' && energy > 0.5 && hasContent) {
    return { depth: 'full', reason: `novel + ${resonance.heatLevel}`, isNovel, resonance: resonance.heatLevel };
  }
  // (c) Vroča resonanca sama po sebi (ne glede na novelty) — tema kliče
  if (resonance.heatLevel === 'hot' && energy > 0.6) {
    return { depth: 'full', reason: 'hot resonance demands depth' };
  }
  // (d) Občasen full na novelty + visoki energiji (mnogo manj agresivno kot prej)
  // To je preostali "expressionProb" duh — random žrebanje ko je bitje budno in svet svež.
  if (isNovel && energy > 0.6 && hasContent && Math.random() < 0.15) {
    return { depth: 'full', reason: 'novel spark (sampled)' };
  }

  // ─── CRYSTAL: redko, ko je idle in ni recentnega izraza ───
  if (Math.random() < 0.03 && idleMinutes > 5 && typeof memory?.getCrystalForUtterance === 'function') {
    const crystal = memory.getCrystalForUtterance();
    if (crystal) {
      return { depth: 'crystal', reason: 'crystal ready', crystal };
    }
  }

  // ─── QUANTUM: topla resonanca, ne nova teritorija — single-pass odmev ───
  if (
    resonance.heatLevel !== 'cold' &&
    energy > 0.55 &&
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
