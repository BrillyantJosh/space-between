import config from './config.js';

const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`;

export async function callLLM(systemPrompt, userPrompt, { temperature = 0.9, maxTokens = 1024 } = {}) {
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature,
          maxOutputTokens: maxTokens
        }
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[LLM] API error:', response.status, err);
      return null;
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.error('[LLM] No text in response:', JSON.stringify(data).slice(0, 200));
      return null;
    }
    return text.trim();
  } catch (err) {
    console.error('[LLM] Request failed:', err.message);
    return null;
  }
}

// =============================================
// ANTHROPIC API (for ROKE / hands only)
// =============================================

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

export async function callAnthropicLLM(systemPrompt, userPrompt, { temperature = 0.3, maxTokens = 4096 } = {}) {
  if (!config.anthropicApiKey) {
    console.error('[LLM:ANTHROPIC] No API key configured');
    return null;
  }
  try {
    const response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.anthropicApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: config.anthropicModel || 'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        temperature,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[LLM:ANTHROPIC] API error:', response.status, err);
      return null;
    }

    const data = await response.json();
    const text = data?.content?.[0]?.text;
    if (!text) {
      console.error('[LLM:ANTHROPIC] No text in response:', JSON.stringify(data).slice(0, 200));
      return null;
    }
    return text.trim();
  } catch (err) {
    console.error('[LLM:ANTHROPIC] Request failed:', err.message);
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
  const raw = await callLLM(systemPrompt, userPrompt, opts);
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
