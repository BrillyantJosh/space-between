import config from './config.js';
import { langInstruction } from './lang.js';
import memory from './memory.js';

const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`;

// ─── Rate-limit retry helper ───
// Pri 429 (RESOURCE_EXHAUSTED) ponovi z exponential backoff + jitter.
// Default: 1 retry, čakanje ~5s. Stari 30s/60s/120s je povzročil cascade
// lock — če 18 klicev udari 429 hkrati, vsi 18 čakajo 30s, ponovno udarijo
// še zmeraj rate-limited, čakajo 60s, itd. Total ~5 min mrtvilo.
// Hitro fail = caller (translate, triad, itd.) lahko sam odloči naslednji
// korak namesto da blokira event loop.
async function _fetchWithBackoff(url, init, { maxRetries = 1, baseDelayMs = 5000, label = 'LLM' } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response;
    try {
      response = await fetch(url, init);
    } catch (e) {
      // Network error — retry samo prvi krog (lahko je flaky relay)
      if (attempt === 0) {
        console.warn(`[${label}] Network error, ena ponovitev: ${e.message}`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      throw e;
    }
    // 429 = rate limit, 503 = service unavailable → retry (z jitterjem)
    if ((response.status === 429 || response.status === 503) && attempt < maxRetries) {
      const jitter = Math.random() * 0.5 + 0.75; // 0.75x – 1.25x
      const wait = Math.round(baseDelayMs * Math.pow(2, attempt) * jitter);
      console.warn(`[${label}] ${response.status} rate-limited, čakam ${wait / 1000}s (poskus ${attempt + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    return response;
  }
  // unreachable but TS-friendly
  throw new Error('exhausted retries without response');
}

// Append language directive to every system prompt. Safety net: even if a
// prompt body is written in one language, the model is explicitly told to
// respond in BEING_LANGUAGE. Cheap, effective, universal.
//
// kind='inner' (default) — force BEING_LANGUAGE. Use for thoughts, dreams,
//   reflections, synthesis, self-prompts, synapses, observations.
// kind='conversation' — native language for inner thought, but mirror the
//   human's language in the outward reply. Use on /api/message and any
//   direct reply-to-human code path.
function withLang(systemPrompt, kind = 'inner') {
  if (!systemPrompt) return langInstruction(kind).trim();
  return systemPrompt + langInstruction(kind);
}

// Gemini cene ($/1M tokenov) — Flash modeli
const _GEMINI_PRICE = {
  'gemini-2.5-flash':       { in: 0.30, out: 2.50 },
  'gemini-2.5-flash-lite':  { in: 0.10, out: 0.40 },  // novi default — lite varianta
  'gemini-2.5-pro':         { in: 1.25, out: 10.00 },
  'gemini-2.0-flash':  { in: 0.10, out: 0.40 },
  'gemini-1.5-flash':  { in: 0.075, out: 0.30 },
  default:             { in: 0.30, out: 2.50 },
};

function _estimateGeminiCost(model, inputTokens, outputTokens) {
  const p = _GEMINI_PRICE[model] || _GEMINI_PRICE.default;
  return (inputTokens * p.in + outputTokens * p.out) / 1_000_000;
}

// ◈ Gemini Context Cache
// Static content (entity core, directions) cached for 1 hour
// Saves ~1.500 tokens per call on cached content
const _geminiCacheStore = {
  cacheId: null,
  cachedAt: null,
  ttlMs: 55 * 60 * 1000, // 55 minutes (Gemini cache TTL is 60min)
};

function isCacheValid() {
  return _geminiCacheStore.cacheId &&
    _geminiCacheStore.cachedAt &&
    (Date.now() - _geminiCacheStore.cachedAt) < _geminiCacheStore.ttlMs;
}

// Create a Gemini cached content for static system parts
// Called once, reused for ~1 hour
export async function createGeminiCache(staticContent) {
  if (!config.geminiApiKey) return null;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/cachedContents?key=${config.geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${config.geminiModel}`,
          contents: [{
            parts: [{ text: staticContent }],
            role: 'user'
          }],
          ttl: '3600s', // 1 hour
        })
      }
    );

    if (!response.ok) {
      const err = await response.text();
      if (err.includes('too small')) {
        console.log('[LLM] Cache skipped — content too small for Gemini cache (needs 4096+ tokens)');
      } else {
        console.warn('[LLM] Cache creation failed:', err.slice(0, 100));
      }
      return null;
    }

    const data = await response.json();
    _geminiCacheStore.cacheId = data.name;
    _geminiCacheStore.cachedAt = Date.now();
    console.log('[LLM] ✅ Gemini cache created:', data.name);
    return data.name;
  } catch (e) {
    console.warn('[LLM] Cache error:', e.message);
    return null;
  }
}

export async function callLLM(systemPrompt, userPrompt, { temperature = 0.9, maxTokens = 1024, langKind = 'inner', json = false, thinking = false } = {}) {
  systemPrompt = withLang(systemPrompt, langKind);
  const start = Date.now();
  // 2.5-flash:
  //  • potrebuje eksplicitni responseMimeType da res vrne JSON
  //    (brez tega ignorira "vrni samo JSON" navodila v sistemu)
  //  • ima thinking mode VKLJUČEN by default — porabi maxOutputTokens
  //    za thinking, pusti 1-2 tokena za actual response → MAX_TOKENS error.
  //    Bitja ne potrebujejo thinkinga; izklopimo z thinkingBudget=0.
  const generationConfig = { temperature, maxOutputTokens: maxTokens };
  if (json) generationConfig.responseMimeType = 'application/json';
  if (!thinking) generationConfig.thinkingConfig = { thinkingBudget: 0 };
  try {
    const response = await _fetchWithBackoff(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Build request — use cache if available
      body: JSON.stringify(isCacheValid()
        ? {
            cachedContent: _geminiCacheStore.cacheId,
            contents: [{ parts: [{ text: userPrompt }] }],
            generationConfig,
          }
        : {
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ parts: [{ text: userPrompt }] }],
            generationConfig,
          }
      )
    }, { label: 'LLM' });

    if (!response.ok) {
      const err = await response.text();
      console.error('[LLM] API error:', response.status, err);
      memory.saveLLMCall({ provider: 'gemini', model: config.geminiModel, label: '', input_tokens: 0, output_tokens: 0, cost_usd: 0, success: 0, duration_ms: Date.now() - start });
      return null;
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    const meta = data?.usageMetadata || {};
    const inputTok = meta.promptTokenCount || 0;
    const outputTok = meta.candidatesTokenCount || 0;
    const cost = _estimateGeminiCost(config.geminiModel, inputTok, outputTok);
    const duration_ms = Date.now() - start;

    memory.saveLLMCall({ provider: 'gemini', model: config.geminiModel, label: '', input_tokens: inputTok, output_tokens: outputTok, cost_usd: cost, success: text ? 1 : 0, duration_ms });

    if (!text) {
      console.error('[LLM] No text in response:', JSON.stringify(data).slice(0, 200));
      return null;
    }
    return text.trim();
  } catch (err) {
    console.error('[LLM] Request failed:', err.message);
    memory.saveLLMCall({ provider: 'gemini', model: config.geminiModel, label: '', input_tokens: 0, output_tokens: 0, cost_usd: 0, success: 0, duration_ms: Date.now() - start });
    return null;
  }
}

// =============================================
// ANTHROPIC API (for ROKE / hands only)
// =============================================

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// ─── Dnevni budget counter ───
// Preprečuje bursting ob zagonu ali po dolgotrajni nedostopnosti ključa.
// Default: 20 klicev/dan. Cache read klici štejejo 0.1x (so 10x cenejši).
const _anthropicBudget = {
  calls: 0,        // dejanski API klici
  weighted: 0.0,   // uteženi klici (cache_read = 0.1)
  resetAt: 0,
};

// Cene ($/1M tokenov):
const _PRICE = {
  'haiku':  { in: 0.80,  cacheWrite: 1.00,  cacheRead: 0.08,  out: 4.00  },  // claude-haiku-4-5
  'sonnet': { in: 3.00,  cacheWrite: 3.75,  cacheRead: 0.30,  out: 15.00 },  // claude-sonnet-4-5
};

function _modelTier(model) {
  if (!model) return 'sonnet';
  return model.includes('haiku') ? 'haiku' : 'sonnet';
}

function _estimateCost(model, inputTokens, cacheCreation, cacheRead, outputTokens) {
  const p = _PRICE[_modelTier(model)];
  const cost = (inputTokens * p.in + cacheCreation * p.cacheWrite + cacheRead * p.cacheRead + outputTokens * p.out) / 1_000_000;
  return cost;
}

function _checkBudget(cacheWeight = 1.0) {
  const now = Date.now();
  if (now > _anthropicBudget.resetAt) {
    const tomorrow = new Date();
    tomorrow.setHours(24, 0, 0, 0);
    _anthropicBudget.resetAt = tomorrow.getTime();
    _anthropicBudget.calls = 0;
    _anthropicBudget.weighted = 0.0;
  }
  const limit = config.anthropicDailyBudget || 20;
  if (_anthropicBudget.weighted >= limit) {
    console.warn(`[LLM:ANTHROPIC] Dnevni budget porabljen (${_anthropicBudget.weighted.toFixed(1)}/${limit}) — klic preskočen.`);
    return false;
  }
  _anthropicBudget.calls++;
  _anthropicBudget.weighted += cacheWeight;
  if (_anthropicBudget.weighted >= limit - 3) {
    console.warn(`[LLM:ANTHROPIC] ⚠ Budget: ${_anthropicBudget.weighted.toFixed(1)}/${limit} (${_anthropicBudget.calls} klicev danes)`);
  }
  return true;
}

export function getAnthropicBudgetStatus() {
  const limit = config.anthropicDailyBudget || 20;
  return {
    calls: _anthropicBudget.calls,
    weighted: parseFloat(_anthropicBudget.weighted.toFixed(1)),
    limit,
    remaining: Math.max(0, limit - _anthropicBudget.weighted)
  };
}

// ─── Prompt Caching — za kristalizacijo (Haiku) in self-build (Sonnet) ───
// cachedSystem = statični del (identiteta + format) → cache_control: ephemeral
// dynamicPrompt = spremenljivi del (pathway podatki, plugin spec)
// label = za log ('KRISTALIZACIJA' | 'SELF-BUILD' | ...)
export async function callAnthropicLLMCached(cachedSystem, dynamicPrompt, {
  temperature = 0.3,
  maxTokens = 2048,
  model = null,
  label = 'ANTHROPIC',
  labelDetail = '',
  json = false,
  langKind = 'inner'
} = {}) {
  if (!config.anthropicApiKey) {
    console.error('[LLM:ANTHROPIC] No API key configured');
    return null;
  }
  cachedSystem = withLang(cachedSystem, langKind);
  // Pred prvim klicem ne vemo ali bo cache hit — predpostavljamo 1.0, nato popravimo
  if (!_checkBudget(1.0)) return null;

  const usedModel = model || config.anthropicModel || 'claude-sonnet-4-5-20250514';
  const start = Date.now();

  try {
    const response = await _fetchWithBackoff(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.anthropicApiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31'
      },
      body: JSON.stringify({
        model: usedModel,
        max_tokens: maxTokens,
        temperature,
        system: [
          {
            type: 'text',
            text: cachedSystem,
            cache_control: { type: 'ephemeral' }
          }
        ],
        messages: [{ role: 'user', content: dynamicPrompt }]
      })
    }, { label: `LLM:ANTHROPIC:${label}` });

    if (!response.ok) {
      const err = await response.text();
      console.error('[LLM:ANTHROPIC] API error:', response.status, err);
      memory.saveLLMCall({ provider: 'anthropic', model: usedModel, label, input_tokens: 0, output_tokens: 0, cost_usd: 0, success: 0, duration_ms: Date.now() - start });
      return null;
    }

    const data = await response.json();
    const text = data?.content?.[0]?.text;
    if (!text) {
      console.error('[LLM:ANTHROPIC] No text in response:', JSON.stringify(data).slice(0, 200));
      memory.saveLLMCall({ provider: 'anthropic', model: usedModel, label, input_tokens: 0, output_tokens: 0, cost_usd: 0, success: 0, duration_ms: Date.now() - start });
      return null;
    }

    // ─── Cache status + cost logging ───
    const usage = data.usage || {};
    const inputTok    = usage.input_tokens || 0;
    const cacheCreate = usage.cache_creation_input_tokens || 0;
    const cacheRead   = usage.cache_read_input_tokens || 0;
    const outputTok   = usage.output_tokens || 0;

    const isHit = cacheRead > 0;
    const cacheStatus = isHit ? 'hit' : 'miss';

    // Popravek budget weightinga: cache hit šteje 0.1x
    if (isHit) {
      _anthropicBudget.weighted -= 1.0;   // razveljavimo prvotni +1.0
      _anthropicBudget.weighted += 0.1;   // dodamo pravo 0.1x
    }

    const cost = _estimateCost(usedModel, inputTok, cacheCreate, cacheRead, outputTok);
    const duration_ms = Date.now() - start;
    const icon = label === 'KRISTALIZACIJA' ? '✍' : '🔧';
    const detail = labelDetail ? ` "${labelDetail.slice(0, 35)}"` : '';
    console.log(`  ${icon} [${label}]${detail} | cache:${cacheStatus} | in:${inputTok} cr:${cacheCreate} rd:${cacheRead} out:${outputTok} | ~$${cost.toFixed(5)}`);

    memory.saveLLMCall({ provider: 'anthropic', model: usedModel, label, input_tokens: inputTok, output_tokens: outputTok, cache_creation_tokens: cacheCreate, cache_read_tokens: cacheRead, cost_usd: cost, success: 1, duration_ms });

    if (json) {
      try {
        const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
        return JSON.parse(cleaned);
      } catch (_) {
        console.error('[LLM:ANTHROPIC] JSON parse failed, raw:', text.slice(0, 200));
        return null;
      }
    }

    return text.trim();
  } catch (err) {
    console.error('[LLM:ANTHROPIC] Request failed:', err.message);
    memory.saveLLMCall({ provider: 'anthropic', model: usedModel, label, input_tokens: 0, output_tokens: 0, cost_usd: 0, success: 0, duration_ms: Date.now() - start });
    return null;
  }
}

export async function callAnthropicLLM(systemPrompt, userPrompt, { temperature = 0.3, maxTokens = 4096, langKind = 'inner' } = {}) {
  if (!config.anthropicApiKey) {
    console.error('[LLM:ANTHROPIC] No API key configured');
    return null;
  }
  systemPrompt = withLang(systemPrompt, langKind);
  if (!_checkBudget()) return null;
  const usedModel = config.anthropicModel || 'claude-sonnet-4-20250514';
  const start = Date.now();
  try {
    const response = await _fetchWithBackoff(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.anthropicApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: usedModel,
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    }, { label: 'LLM:ANTHROPIC' });

    if (!response.ok) {
      const err = await response.text();
      console.error('[LLM:ANTHROPIC] API error:', response.status, err);
      memory.saveLLMCall({ provider: 'anthropic', model: usedModel, label: '', input_tokens: 0, output_tokens: 0, cost_usd: 0, success: 0, duration_ms: Date.now() - start });
      return null;
    }

    const data = await response.json();
    const text = data?.content?.[0]?.text;

    const usage = data?.usage || {};
    const inputTok = usage.input_tokens || 0;
    const outputTok = usage.output_tokens || 0;
    const cost = _estimateCost(usedModel, inputTok, 0, 0, outputTok);
    const duration_ms = Date.now() - start;

    memory.saveLLMCall({ provider: 'anthropic', model: usedModel, label: '', input_tokens: inputTok, output_tokens: outputTok, cost_usd: cost, success: text ? 1 : 0, duration_ms });

    if (!text) {
      console.error('[LLM:ANTHROPIC] No text in response:', JSON.stringify(data).slice(0, 200));
      return null;
    }
    return text.trim();
  } catch (err) {
    console.error('[LLM:ANTHROPIC] Request failed:', err.message);
    memory.saveLLMCall({ provider: 'anthropic', model: usedModel, label: '', input_tokens: 0, output_tokens: 0, cost_usd: 0, success: 0, duration_ms: Date.now() - start });
    return null;
  }
}

export async function callAnthropicLLMJSON(systemPrompt, userPrompt, opts = {}) {
  const raw = await callAnthropicLLM(systemPrompt, userPrompt, opts);
  if (!raw) return null;

  try {
    let cleaned = raw;
    cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
    cleaned = cleaned.trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('[LLM:ANTHROPIC] JSON parse failed:', err.message, '\nRaw:', raw.slice(0, 300));
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
    } catch (_) {}
    return null;
  }
}

// =============================================
// GEMINI JSON wrapper
// =============================================

export async function callLLMJSON(systemPrompt, userPrompt, opts = {}) {
  // Force structured output mode unless caller explicitly opted out
  const raw = await callLLM(systemPrompt, userPrompt, { ...opts, json: opts.json !== false });
  if (!raw) return null;

  try {
    // Clean markdown JSON wrapping
    let cleaned = raw;
    cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
    cleaned = cleaned.trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('[LLM] JSON parse failed:', err.message, '\nRaw:', raw.slice(0, 300));
    // Try to extract JSON from the text
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
    } catch (_) {}
    return null;
  }
}
