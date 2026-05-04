// ═══ TRIAD SCORING — dialektična ocena vsake triade ═══
//
// Background worker, ki vsako triado oceni po 5 kriterijih (po prompt-u
// uporabnika). Rezultati se shranijo v `triad_scores` tabelo. Job stanje
// se persistira v `triad_scoring_jobs` da se lahko po crashu ali deployu
// nadaljuje (resume = preprosto ponovni zagon — preskoči že ocenjene).
//
// Zmožnosti:
//   - Mutex: en job naenkrat (po procesni ravni + DB).
//   - Pacing: konfigurabilen sleep med klici (default 250ms za Gemini).
//   - Cancel: `stopJob()` ustavi worker po naslednjem batchu.
//   - Resume-friendly: po crashu se ne ponovi — zadnji job ostane v DB
//     z status='running', a ko proces vstane, marker isRunning je false
//     in user lahko zažene novo job.

import memory from './memory.js';
import { callLLMJSON, callAnthropicLLMJSON } from './llm.js';
import config from './config.js';

const PROMPT = `Ti si ekspert za triadno dialektično razmišljanje. Oceni naslednjo triado po 5 kriterijih.

OCENI po teh kriterijih (vsak 0-2 točke):

1. PARADOKS V ANTITEZI
   0 = antiteza samo negira tezo ali našteva tveganja
   1 = antiteza afirmira eno stran ampak doda napetost
   2 = antiteza drži obe resnici hkrati v napetosti

2. EMERGENTNA BESEDA V SINTEZI
   0 = sinteza ne vsebuje nobene nove besede/koncepta
   1 = sinteza uvede eno novo besedo ki je bila nakazana
   2 = sinteza uvede koncept ki ni bil prisoten v tezi ali antitezi

3. METAFORA KOT MEHANIZEM
   0 = ni metafore
   1 = metafora je prisotna kot okras
   2 = metafora je instrument transformacije — brez nje sinteza ne deluje

4. SINTEZA NI KOMPROMIS
   0 = sinteza je povzetek ali balans obeh strani
   1 = sinteza preseže obe strani ampak še vleče nazaj
   2 = sinteza je kvalitativni skok — nova kategorija

5. META-RAVEN (bonus)
   0 = sinteza govori o vsebini
   1 = sinteza nakazuje na proces
   2 = sinteza reflektira naravo sinteze same

Vrni IZKLJUČNO JSON brez dodatnih besed:
{
  "paradoks": <0-2>,
  "emergentna_beseda": <0-2>,
  "metafora": <0-2>,
  "ni_kompromis": <0-2>,
  "meta_raven": <0-2>,
  "skupaj": <vsota 0-10>
}`;

// In-process state. DB job row is the truth, but this gives O(1) introspection.
let _state = {
  isRunning: false,
  jobId: null,
  shouldStop: false,
  current: null, // current triad being processed
  startedAt: null,
};

function buildUserPrompt(t) {
  const syn = (t.synthesis_content || t.synthesis_reason || '').trim();
  return `TRIADA #${t.id}:
TEZA: ${(t.thesis || '').trim()}
ANTITEZA: ${(t.antithesis || '').trim()}
SINTEZA: ${syn}`;
}

function clamp02(n) {
  const x = parseInt(n, 10);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(2, x));
}

function normalizeResult(raw) {
  const paradoks = clamp02(raw.paradoks);
  const emergentna_beseda = clamp02(raw.emergentna_beseda);
  const metafora = clamp02(raw.metafora);
  const ni_kompromis = clamp02(raw.ni_kompromis);
  const meta_raven = clamp02(raw.meta_raven);
  const skupaj = paradoks + emergentna_beseda + metafora + ni_kompromis + meta_raven;
  return { paradoks, emergentna_beseda, metafora, ni_kompromis, meta_raven, skupaj };
}

async function scoreOne(triad, model) {
  const userPrompt = buildUserPrompt(triad);
  let raw;
  if (model === 'claude') {
    raw = await callAnthropicLLMJSON(PROMPT, userPrompt, {
      temperature: 0.2,
      maxTokens: 200,
      langKind: 'inner',
    });
  } else {
    raw = await callLLMJSON(PROMPT, userPrompt, {
      temperature: 0.2,
      maxTokens: 200,
      langKind: 'inner',
    });
  }
  if (!raw || typeof raw !== 'object') {
    throw new Error('LLM ni vrnil veljavnega JSON-a');
  }
  return normalizeResult(raw);
}

export function getStatus() {
  // Combine in-process state with DB record for richest view
  const dbJob = _state.jobId ? memory.getScoringJob(_state.jobId) : memory.getActiveScoringJob();
  const totals = {
    scorable: memory.countScorableTriads(),
    scored: memory.countScoredTriads(),
  };
  return {
    isRunning: _state.isRunning,
    shouldStop: _state.shouldStop,
    job: dbJob || null,
    current: _state.current,
    totals,
  };
}

export function stopJob() {
  if (!_state.isRunning) return false;
  _state.shouldStop = true;
  return true;
}

export async function startJob({ model = 'gemini', limit = null, fromId = null, toId = null, rescore = false, paceMs = null } = {}) {
  if (_state.isRunning) {
    throw new Error('Drug job že teče');
  }

  const useModel = model === 'claude' ? 'claude' : 'gemini';
  const modelName = useModel === 'claude' ? config.anthropicModel : config.geminiModel;
  // Default pacing: gemini 250ms, claude 500ms (claude is slower + more rate-limited)
  const sleepMs = typeof paceMs === 'number' && paceMs >= 0 ? paceMs : (useModel === 'claude' ? 500 : 250);

  // Validate API key presence
  if (useModel === 'claude' && !(config.anthropicApiKey || '').trim()) {
    throw new Error('ANTHROPIC_API_KEY ni nastavljen');
  }
  if (useModel === 'gemini' && !(config.geminiApiKey || '').trim()) {
    throw new Error('GEMINI_API_KEY ni nastavljen');
  }

  // If rescore is true, we ignore existing scores and process all matching triads.
  // If false, we only fetch unscored.
  let triads;
  if (rescore) {
    const allLimit = Math.min(5000, parseInt(limit, 10) || 5000);
    // Get all scorable triads, ignore existing scores (will overwrite via INSERT OR REPLACE)
    triads = (function () {
      // Reach into memory's getTriadsPaginated semantics but unconstrained
      // We just want id+thesis+antithesis+synthesis fields for all scorable triads.
      const stmt = memory._db || null;
      // Fallback: grab in chunks via paginated calls
      const out = [];
      let page = 1;
      const pageSize = 500;
      while (out.length < allLimit) {
        const chunk = memory.getTriadsPaginated(page, pageSize);
        for (const r of chunk.rows) {
          const synOk = (r.synthesis_content && r.synthesis_content.trim()) ||
                        (r.synthesis_reason && r.synthesis_reason.trim());
          if (r.thesis && r.thesis.trim() && r.antithesis && r.antithesis.trim() && synOk) {
            out.push(r);
          }
          if (out.length >= allLimit) break;
        }
        if (chunk.rows.length < pageSize) break;
        page++;
      }
      return out;
    })();
  } else {
    triads = memory.getUnscoredTriads(limit || 5000, fromId, toId);
  }

  if (triads.length === 0) {
    throw new Error('Ni triad za ocenjevanje (vse so že ocenjene? — uporabi rescore=true)');
  }

  const jobId = memory.createScoringJob({
    status: 'running',
    total: triads.length,
    model: modelName,
    rescore,
  });

  _state = {
    isRunning: true,
    shouldStop: false,
    jobId,
    current: null,
    startedAt: Date.now(),
  };

  console.log(`[SCORING] Job #${jobId} started — ${triads.length} triad, model=${modelName}, pace=${sleepMs}ms`);

  // Run in background — don't await
  (async () => {
    let scored = 0;
    let errors = 0;
    let skipped = 0;
    let lastError = null;
    let lastTriadId = null;

    for (const t of triads) {
      if (_state.shouldStop) {
        console.log(`[SCORING] Job #${jobId} stop requested at ${scored}/${triads.length}`);
        break;
      }
      _state.current = { id: t.id, scored, total: triads.length };

      try {
        const result = await scoreOne(t, useModel);
        memory.saveTriadScore({ triad_id: t.id, ...result, model: modelName });
        scored++;
        lastTriadId = t.id;
      } catch (e) {
        errors++;
        lastError = `#${t.id}: ${e.message}`;
        console.error(`[SCORING] error on #${t.id}: ${e.message}`);
        // If rate-limited, back off harder
        if (/429|rate|quota/i.test(e.message)) {
          await new Promise(r => setTimeout(r, 5000));
        }
      }

      // Update DB every 10 scored or on errors so the UI shows progress
      if ((scored + errors) % 10 === 0 || errors > 0) {
        memory.updateScoringJob(jobId, {
          scored, errors, skipped,
          last_triad_id: lastTriadId,
          last_error: lastError,
        });
      }

      if (sleepMs > 0) await new Promise(r => setTimeout(r, sleepMs));
    }

    const finalStatus = _state.shouldStop ? 'cancelled' : (errors > 0 && scored === 0 ? 'error' : 'done');
    memory.updateScoringJob(jobId, {
      status: finalStatus,
      finished_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
      scored, errors, skipped,
      last_triad_id: lastTriadId,
      last_error: lastError,
    });

    console.log(`[SCORING] Job #${jobId} ${finalStatus} — ${scored} scored, ${errors} errors`);
    _state = { isRunning: false, jobId: null, shouldStop: false, current: null, startedAt: null };
  })().catch(err => {
    console.error('[SCORING] fatal:', err);
    memory.updateScoringJob(jobId, {
      status: 'error',
      finished_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
      last_error: 'FATAL: ' + err.message,
    });
    _state = { isRunning: false, jobId: null, shouldStop: false, current: null, startedAt: null };
  });

  return { jobId, total: triads.length, model: modelName, paceMs: sleepMs };
}

export default { startJob, stopJob, getStatus };
