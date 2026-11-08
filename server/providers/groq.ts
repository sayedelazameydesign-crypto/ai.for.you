import type { Provider, ProviderResponse } from './types.ts'

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/**
 * Reasoning models spend hidden reasoning tokens from the same completion budget.
 * Too small a budget makes Groq abort JSON mode with HTTP 400 (json_validate_failed)
 * before any document is produced, so keep headroom and ask gpt-oss for low effort.
 * These fields are gpt-oss specific and are never sent to other models.
 */
export function completionBudget(model: string, maxTokens = 4096): Record<string, unknown> {
  const base = { max_completion_tokens: maxTokens }
  return /^openai\/gpt-oss-/i.test(model)
    ? { ...base, reasoning_effort: 'low', include_reasoning: false }
    : base
}

export const groq: Provider = {
  id: 'groq',
  label: 'Groq',
  keyEnv: 'GROQ_API_KEY',
  defaultModel: 'openai/gpt-oss-120b',
  modelFields: completionBudget,
  async complete(request, apiKey, signal, fetcher): Promise<ProviderResponse> {
    const response = await fetcher(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        temperature: 0.5,
        ...completionBudget(request.model, request.maxTokens),
        response_format: { type: 'json_object' },
      }),
      signal,
    })
    let payload: unknown = null
    try { payload = await response.json() } catch { /* Non-JSON upstream body is discarded. */ }
    return { ok: response.ok, status: response.status, retryAfter: response.headers.get('retry-after'), payload }
  },
  content(payload) {
    if (!isRecord(payload) || !Array.isArray(payload.choices)) return undefined
    const first = payload.choices[0]
    return isRecord(first) && isRecord(first.message) ? first.message.content : undefined
  },
}
