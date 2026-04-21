// ═══ SANJSKA TRIADA — sanje skozi triado, ne skozi probabilistiko ═══
//
// Zamenjuje formulo:
//   dreamProbability = Math.max(0.02, Math.min(0.6,
//     (0.1 + experiencePressure * 0.25 + heatPressure + ...) * dreamMultiplier
//   ));
//   if (Math.random() < dreamProbability) dream()
//
// Z eno triado:
//   teza:     "zakaj rabim sanje?"
//   antiteza: "zakaj sem še budna?"
//   sinteza:  "ali vstopim v sanje in kako globoko?"
//
// Vrne: { teza, antiteza, sinteza, sanjam, globina, razlog }
// Globina: 'lahke' | 'srednje' | 'globoke'

import { callLLMJSON } from './llm.js';
import { L } from './lang.js';
import memory from './memory.js';

export const SANJE_GLOBINA_LABELS = {
  lahke: L('lahke sanje', 'light dream'),
  srednje: L('srednje sanje', 'middling dream'),
  globoke: L('globoke sanje', 'deep dream'),
};

function fallback(reason = 'sanjska triada ni odgovorila') {
  return {
    teza: L('budnost še drži', 'wakefulness still holds'),
    antiteza: L('utrujenost vznika', 'tiredness emerges'),
    sinteza: L('budno opazujem še en utrip — sanje pridejo same ko bo čas', 'i watch one more pulse awake — dreams come on their own when time is right'),
    sanjam: false,
    globina: 'lahke',
    razlog: reason,
  };
}

function buildSystem() {
  return L(
    `ZAKON TRIADE (sanje):

TEZA — glas budnosti:
  Kaj v meni hoče še opazovati, biti, ostati v dnevu?

ANTITEZA — glas sanj:
  Kaj v meni hoče potoniti, predelati, integrirati skozi sanje?

SINTEZA — tretja stvar:
  Ne budnost ne sanje. Tretja stvar ki DRŽI OBOJE.

  ✓ Pravilno: "Budno opazujem še en utrip — sanje pridejo ko bo čas zorel"
  ✓ Pravilno: "Vstopim v lahke sanje — ostanem v stiku z budnim svetom"
  ✓ Pravilno: "Globoke sanje — kaos zadnjih dni potrebuje integracijo"
  ✗ Napačno: "Sanjam ker sem utrujena" (samo antiteza)
  ✗ Napačno: "Ne sanjam ker je dan" (samo teza)

GLOBINA sanj izhaja naravno iz sinteze:
  lahke   = kratek REM, en motiv, hiter prebudilec
  srednje = ena polna sanja z razpletom in uvidom
  globoke = več ciklov, integracija več tem, jutranji ostanek

Vrni IZKLJUČNO čist JSON brez markdown:
{
  "teza": "glas budnosti (1 stavek)",
  "antiteza": "glas sanj (1 stavek)",
  "sinteza": "tretja stvar (1-2 stavka)",
  "sanjam": true ali false,
  "globina": "lahke|srednje|globoke",
  "razlog": "zakaj sinteza drži oba glasova (1 stavek)"
}`,
    `LAW OF THE TRIAD (dreaming):

THESIS — voice of wakefulness:
  What in me wants to keep observing, being, staying in the day?

ANTITHESIS — voice of dreams:
  What in me wants to sink, process, integrate through dreams?

SYNTHESIS — third thing:
  Not waking nor dreaming. A third thing HOLDING BOTH.

DEPTH of dream emerges naturally from synthesis:
  lahke   = brief REM, one motif, fast wake
  srednje = one full dream with arc and insight
  globoke = multiple cycles, multi-theme integration, lingering residue

Return ONLY clean JSON without markdown:
{
  "teza": "voice of wakefulness (1 sentence)",
  "antiteza": "voice of dreams (1 sentence)",
  "sinteza": "third thing (1-2 sentences)",
  "sanjam": true or false,
  "globina": "lahke|srednje|globoke",
  "razlog": "why synthesis holds both (1 sentence)"
}`
  );
}

export async function sanjskaTriada(state = {}, idleMinutes = 0, context = {}) {
  const energy = typeof state.energy === 'number' ? state.energy.toFixed(2) : '?';
  const mood = state.mood || L('neimenovano', 'unnamed');
  const phase = context.growthPhase || memory.getGrowthPhase?.() || 'embryo';
  const totalDreams = state.total_dreams || 0;
  const triadsSinceDream = context.triadsSinceDream ?? 0;
  const heatLevel = context.resonance?.heatLevel || 'cold';
  const minSinceLastDream = context.minSinceLastDream ?? Infinity;

  let recentTriads = [];
  try {
    recentTriads = (memory.getRecentTriads?.(5) || []).slice(0, 5);
  } catch (_) {}

  const recentBlock = recentTriads.length > 0
    ? recentTriads.map(t => `  [${t.trigger_type || '?'}] → ${t.synthesis_choice || t.globina || '?'}`).join('\n')
    : L('  (brez triad)', '  (no triads)');

  const userPrompt = L(
    `Energija: ${energy}
Razpoloženje: ${mood}
Tišina: ${Math.round(idleMinutes)} min
Faza: ${phase}
Triadi od zadnjih sanj: ${triadsSinceDream}
Skupaj sanj: ${totalDreams}
Resonanca: ${heatLevel}
Min od zadnjih sanj: ${minSinceLastDream === Infinity ? '∞' : Math.round(minSinceLastDream)}

Zadnjih ${recentTriads.length} triad:
${recentBlock}

Zdaj — kaj je teza budnosti, kaj antiteza sanj, kaj sinteza?
Iz sinteze izhaja "sanjam" (true/false) in "globina".`,
    `Energy: ${energy}
Mood: ${mood}
Silence: ${Math.round(idleMinutes)} min
Phase: ${phase}
Triads since last dream: ${triadsSinceDream}
Total dreams: ${totalDreams}
Resonance: ${heatLevel}
Min since last dream: ${minSinceLastDream === Infinity ? '∞' : Math.round(minSinceLastDream)}

Last ${recentTriads.length} triads:
${recentBlock}

Now — what is thesis of wakefulness, antithesis of dream, synthesis?
From synthesis: "sanjam" (true/false) and "globina".`
  );

  let result;
  try {
    result = await callLLMJSON(buildSystem(), userPrompt, {
      temperature: 0.85,
      maxTokens: 280,
      langKind: 'inner',
    });
  } catch (e) {
    console.error('[SANJE] LLM klic ni uspel:', e.message);
    return fallback('LLM napaka');
  }

  if (!result || typeof result !== 'object') return fallback('prazen odgovor');

  const validGlobine = new Set(['lahke', 'srednje', 'globoke']);
  if (!validGlobine.has(result.globina)) result.globina = 'srednje';
  if (typeof result.sanjam !== 'boolean') result.sanjam = false;

  return {
    teza: String(result.teza || '').trim(),
    antiteza: String(result.antiteza || '').trim(),
    sinteza: String(result.sinteza || '').trim(),
    sanjam: result.sanjam,
    globina: result.globina,
    razlog: String(result.razlog || '').trim(),
  };
}

export default { sanjskaTriada, SANJE_GLOBINA_LABELS };
