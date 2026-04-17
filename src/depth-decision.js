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
  // Embryo phase: vedno full (bitje se še gradi, vsako iskrico potrebuje)
  if (growthPhase === 'embryo' || growthPhase === 'newborn') {
    return { depth: 'full', reason: `early phase: ${growthPhase}` };
  }

  const triggerStr = (typeof triggerContent === 'string' ? triggerContent : '').trim();
  const hasContent = triggerStr.length > 0;
  const energy = typeof state.energy === 'number' ? state.energy : 0.5;
  const silenceAffinity = typeof state.silence_affinity === 'number' ? state.silence_affinity : 0.3;

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

  // Sveži feed od poznanih oseb
  const hasFreshKnownFeed = (feedBuffer || []).some(e => {
    if (!e?.pubkey || typeof memory?.getIdentity !== 'function') return false;
    const identity = memory.getIdentity(e.pubkey);
    return identity && identity.name && identity.name !== 'neznanec' && identity.name !== '';
  });

  // ─── FULL: nove dialektike ali znan sogovornik v feedu ───
  if (isNovel && energy > 0.4 && hasContent) {
    return { depth: 'full', reason: 'novel territory', isNovel, resonance: resonance.heatLevel };
  }
  if (hasFreshKnownFeed) {
    return { depth: 'full', reason: 'known sogovornik in feed' };
  }

  // ─── CRYSTAL: redko, ko je idle in ni recentnega izraza ───
  if (Math.random() < 0.03 && idleMinutes > 5 && !wasRecent && typeof memory?.getCrystalForUtterance === 'function') {
    const crystal = memory.getCrystalForUtterance();
    if (crystal) {
      return { depth: 'crystal', reason: 'crystal ready', crystal };
    }
  }

  // ─── QUANTUM: resonance + energija + ne recentno + ne novo ───
  if (
    resonance.heatLevel !== 'cold' &&
    energy > 0.6 &&
    !wasRecent &&
    !isNovel &&
    hasContent
  ) {
    return { depth: 'quantum', reason: `hot resonance (${resonance.heatLevel})`, resonance: resonance.heatLevel };
  }

  // ─── SILENT: nothing new under the sun ───
  let reason = 'nothing new';
  if (wasRecent) reason = 'recently expressed';
  else if (energy < 0.4) reason = 'low energy';
  else if (resonance.heatLevel === 'cold') reason = 'cold resonance';
  else if (silenceAffinity > 0.7) reason = 'high silence affinity';
  return { depth: 'silent', reason };
}

export const DEPTH_LABELS = {
  full: 'polna triada',
  quantum: 'kvantna sinteza',
  crystal: 'govor iz kristala',
  silent: 'tišina',
};
