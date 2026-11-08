import { describe, expect, it, vi } from 'vitest'
import { completionBudget, handleRequest, isConfigured, resolveServerEnv, SERVER_ENV_KEYS, validateRequest, type AIEnvironment } from '../server/ai'
import { marketingExample } from '../src/lib/marketing'
import { summaryExample } from '../src/lib/summary'

const env = { GROQ_API_KEY: 'test-server-secret-not-real', AI_ACCESS_CODE: 'test-access-code', AI_DAILY_LIMIT: '40' }
let time = 1800000000000
function request(body: unknown = { tool: 'marketing', input: marketingExample, consent: true }, headers: Record<string, string> = {}) {
  return new Request('https://example.test/api/ai', { method: 'POST', headers: { 'content-type': 'application/json', 'x-lek-access': env.AI_ACCESS_CODE, ...headers }, body: JSON.stringify(body) })
}
function config(result: unknown, fetcher = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: JSON.stringify(result) } }] }))) {
  time += 61000
  const scoped: AIEnvironment = { ...env }
  return { env: scoped, fetcher, now: () => time, sleep: async () => {} }
}
const marketingResult = { variants: [{ id: 'v1', label: 'قصة', text: 'نبتة لمن يحب النباتات.' }] }

describe('server-only AI configuration', () => {
  it('requires both a provider key and a separate application access code', () => {
    expect(isConfigured({})).toBe(false)
    expect(isConfigured({ GROQ_API_KEY: 'secret' })).toBe(false)
    expect(isConfigured({ ...env, AI_ACCESS_CODE: 'short' })).toBe(false)
    expect(isConfigured(env)).toBe(true)
  })
  it('reports status without disclosing credentials', async () => {
    const response = await handleRequest(new Request('https://example.test/api/status'), { env })
    expect(await response.clone().json()).toEqual({ configured: true, provider: 'Groq' })
    expect(JSON.stringify(await response.json())).not.toContain(env.GROQ_API_KEY)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
  it('keeps local tools usable with a clear unavailable response', async () => {
    const response = await handleRequest(request(), { env: {} })
    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe('not-configured')
  })
  it('rejects cross-site requests, wrong access codes and missing consent', async () => {
    expect((await handleRequest(request(undefined, { origin: 'https://evil.test' }), config(marketingResult))).status).toBe(403)
    expect((await handleRequest(request(undefined, { 'sec-fetch-site': 'cross-site' }), config(marketingResult))).status).toBe(403)
    expect((await handleRequest(request(undefined, { 'x-lek-access': 'wrong' }), config(marketingResult))).status).toBe(401)
    expect((await handleRequest(request({ tool: 'marketing', input: marketingExample, consent: false }), config(marketingResult))).status).toBe(400)
  })
  it('validates tool-specific types and limits', () => {
    expect(validateRequest({ tool: 'marketing', input: marketingExample, consent: true })).toBe(true)
    expect(validateRequest({ tool: 'summary', input: { text: summaryExample, language: 'ar', length: 'short' }, consent: true })).toBe(true)
    expect(validateRequest({ tool: 'code', input: { code: 'const x = 1;', language: 'javascript' }, consent: true })).toBe(true)
    expect(validateRequest({ tool: 'other', input: {}, consent: true })).toBe(false)
    expect(validateRequest({ tool: 'marketing', input: { ...marketingExample, product: 123 }, consent: true })).toBe(false)
    expect(validateRequest({ tool: 'summary', input: { text: 'x'.repeat(12001), language: 'ar', length: 'short' }, consent: true })).toBe(false)
    expect(validateRequest({ tool: 'code', input: { code: 'x', language: 'python' }, consent: true })).toBe(false)
  })
  it('rejects oversized streamed bodies even without content-length', async () => {
    const req = request({ tool: 'marketing', input: { ...marketingExample, benefit: 'x'.repeat(65000) }, consent: true })
    expect((await handleRequest(req, config(marketingResult))).status).toBe(413)
  })
  it('sends credentials only to Groq and returns labeled results', async () => {
    const setup = config(marketingResult)
    const response = await handleRequest(request(), setup)
    expect(response.status).toBe(200)
    expect((await response.json()).result.mode).toBe('ai')
    expect(setup.fetcher).toHaveBeenCalledOnce()
    const [url, init] = setup.fetcher.mock.calls[0]
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions')
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${env.GROQ_API_KEY}`)
    expect(JSON.parse(String(init?.body)).response_format).toEqual({ type: 'json_object' })
  })
  it('discards unverified AI code rewrites', async () => {
    const response = await handleRequest(request({ tool: 'code', input: { code: 'const x = 1;', language: 'javascript' }, consent: true }), config({ diagnostics: [], suggestions: ['راجع الاختبارات.'], formatted: 'dangerouslyRewritten();', note: 'مراجعة ساكنة.' }))
    expect(response.status).toBe(200)
    const { result } = await response.json()
    expect(result.mode).toBe('ai')
    expect(result.formatted).toBeUndefined()
  })
  it('computes cloud summary statistics from the actual generated summary', async () => {
    const response = await handleRequest(request({ tool: 'summary', input: { text: summaryExample, language: 'ar', length: 'short' }, consent: true }), config({ summary: 'أولويات واضحة.', keyPoints: ['حدد الأولويات.'], keywords: ['أولويات'] }))
    expect(response.status).toBe(200)
    const { result } = await response.json()
    expect(result.stats.reduction).toBe(99)
    expect(result.stats.words).toBeGreaterThan(100)
  })
  it('leaves room for reasoning tokens so JSON mode is not aborted upstream', async () => {
    const setup = config(marketingResult)
    expect((await handleRequest(request(), setup)).status).toBe(200)
    const sent = JSON.parse(String(setup.fetcher.mock.calls[0][1]?.body))
    expect(sent.max_completion_tokens).toBeGreaterThanOrEqual(4096)
    expect(sent.reasoning_effort).toBe('low')
    expect(sent.include_reasoning).toBe(false)
  })
  it('only sends gpt-oss reasoning fields to gpt-oss models', () => {
    expect(completionBudget('openai/gpt-oss-120b')).toEqual({ max_completion_tokens: 4096, reasoning_effort: 'low', include_reasoning: false })
    expect(completionBudget('openai/gpt-oss-20b')).toHaveProperty('reasoning_effort', 'low')
    expect(completionBudget('llama-3.3-70b-versatile')).toEqual({ max_completion_tokens: 4096 })
    expect(completionBudget('qwen/qwen3-32b')).not.toHaveProperty('include_reasoning')
  })
  it('maps a rejected provider request to an actionable owner-facing error', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ error: { message: 'upstream detail', code: 'json_validate_failed' } }, { status: 400 }))
    const response = await handleRequest(request(), config({}, fetcher))
    expect(response.status).toBe(502)
    const payload = await response.json()
    expect(payload.error.code).toBe('provider-request')
    expect(JSON.stringify(payload)).not.toContain('upstream detail')
  })
  it('rejects malformed provider output', async () => {
    const response = await handleRequest(request(), config({ variants: 'not an array' }))
    expect(response.status).toBe(502)
  })
  it('maps provider quota errors without leaking provider bodies', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('sensitive upstream body', { status: 429, headers: { 'retry-after': '30' } }))
    const response = await handleRequest(request(), config({}, fetcher))
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('30')
    expect(await response.text()).not.toContain('sensitive upstream body')
  })
  it('handles network failures and timeouts safely', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => { throw new Error('secret internal details') })
    const response = await handleRequest(request(), config({}, fetcher))
    expect(response.status).toBe(504)
    expect(await response.text()).not.toContain('secret internal details')
  })
  it('enforces a per-client minute ceiling', async () => {
    const setup = config(marketingResult)
    const ip = `test-client-${time}`
    for (let i = 0; i < 6; i++) expect((await handleRequest(request(), setup, ip)).status).toBe(200)
    expect((await handleRequest(request(), setup, ip)).status).toBe(429)
  })
  it('enforces the deployment daily ceiling', async () => {
    time += 86400000
    const setup = config(marketingResult)
    setup.env.AI_DAILY_LIMIT = '1'
    expect((await handleRequest(request(), setup, `daily-a-${time}`)).status).toBe(200)
    expect((await handleRequest(request(), setup, `daily-b-${time}`)).status).toBe(429)
  })
  it('does not burn the deployment daily ceiling on rejected or misconfigured requests', async () => {
    time += 86400000
    const setup = config(marketingResult)
    setup.env.AI_DAILY_LIMIT = '1'

    const badJson = new Request('https://example.test/api/v1/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-lek-access': env.AI_ACCESS_CODE },
      body: '{not-valid-json',
    })
    expect((await handleRequest(badJson, setup, `rej-json-${time}`)).status).toBe(400)

    const oversized = request({ tool: 'marketing', input: { ...marketingExample, benefit: 'x'.repeat(65000) }, consent: true })
    expect((await handleRequest(oversized, setup, `rej-size-${time}`)).status).toBe(413)

    const noConsent = request({ tool: 'marketing', input: marketingExample, consent: false })
    expect((await handleRequest(noConsent, setup, `rej-consent-${time}`)).status).toBe(400)

    const badInput = request({ tool: 'summary', input: { text: 'قصير', language: 'ar', length: 'short' }, consent: true })
    expect((await handleRequest(badInput, setup, `rej-input-${time}`)).status).toBe(400)

    const badModelSetup = { ...setup, env: { ...setup.env, GROQ_MODEL: 'bad model spaces!' } }
    expect((await handleRequest(request(), badModelSetup, `rej-model-${time}`)).status).toBe(503)
    expect(setup.fetcher).not.toHaveBeenCalled()

    // The single daily slot must still be available for a valid request.
    expect((await handleRequest(request(), setup, `valid-after-rejections-${time}`)).status).toBe(200)
    expect(setup.fetcher).toHaveBeenCalledOnce()
    expect((await handleRequest(request(), setup, `second-valid-${time}`)).status).toBe(429)
  })
  it('still throttles per-client bursts of invalid requests without starving other clients', async () => {
    time += 86400000
    const setup = config(marketingResult)
    setup.env.AI_DAILY_LIMIT = '1'
    const attacker = `burst-attacker-${time}`
    const makeBad = () => new Request('https://example.test/api/v1/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-lek-access': env.AI_ACCESS_CODE },
      body: '{broken',
    })

    for (let i = 0; i < 6; i++) {
      expect((await handleRequest(makeBad(), setup, attacker)).status).toBe(400)
    }
    const throttled = await handleRequest(makeBad(), setup, attacker)
    expect(throttled.status).toBe(429)
    expect((await throttled.json()).error.code).toBe('rate-limit')

    // Another client can still spend the untouched daily quota slot.
    expect((await handleRequest(request(), setup, `honest-client-${time}`)).status).toBe(200)
  })
  it('enforces the 280-character X limit on provider output while keeping longer posts elsewhere', async () => {
    const xInput = { ...marketingExample, platform: 'x' as const }
    const tooLongForX = { variants: [{ id: 'v1', label: 'منشور', text: 'س'.repeat(281) }] }
    const rejected = await handleRequest(request({ tool: 'marketing', input: xInput, consent: true }), config(tooLongForX))
    expect(rejected.status).toBe(502)
    expect((await rejected.json()).error.code).toBe('output')

    const exactX = { variants: [{ id: 'v1', label: 'منشور', text: 'س'.repeat(280) }] }
    const acceptedX = await handleRequest(request({ tool: 'marketing', input: xInput, consent: true }), config(exactX))
    expect(acceptedX.status).toBe(200)

    const longLinkedIn = { variants: [{ id: 'v1', label: 'منشور', text: 'س'.repeat(600) }] }
    const acceptedLinkedIn = await handleRequest(
      request({ tool: 'marketing', input: { ...marketingExample, platform: 'linkedin' }, consent: true }),
      config(longLinkedIn),
    )
    expect(acceptedLinkedIn.status).toBe(200)
  })
  it('forwards every declared server environment key without leaking client variables', () => {
    const loaded = {
      GROQ_API_KEY: 'key-from-dotenv',
      GROQ_MODEL: '',
      AI_ACCESS_CODE: 'access-from-dotenv',
      AI_DAILY_LIMIT: '75',
      AI_PROVIDER: 'groq',
      AI_MAX_TOKENS: '2048',
      AI_ALLOWED_ORIGINS: 'https://celia.sh',
      AI_TIMEOUT_MS: '15000',
      AI_TRUSTED_PROXY: 'x-vercel-forwarded-for',
      VITE_SITE_URL: 'https://celia.sh',
      UNRELATED_SECRET: 'ignored',
    }
    const fallback = { GROQ_MODEL: 'llama-3.3-70b-versatile', AI_MAX_TOKENS: '4096' }
    const resolved = resolveServerEnv(loaded, fallback)
    expect(SERVER_ENV_KEYS).toHaveLength(9)
    expect(resolved).toEqual({
      GROQ_API_KEY: 'key-from-dotenv',
      GROQ_MODEL: 'llama-3.3-70b-versatile',
      AI_ACCESS_CODE: 'access-from-dotenv',
      AI_DAILY_LIMIT: '75',
      AI_PROVIDER: 'groq',
      AI_MAX_TOKENS: '2048',
      AI_ALLOWED_ORIGINS: 'https://celia.sh',
      AI_TIMEOUT_MS: '15000',
      AI_TRUSTED_PROXY: 'x-vercel-forwarded-for',
    })
    expect(resolved).not.toHaveProperty('VITE_SITE_URL')
    expect(resolved).not.toHaveProperty('UNRELATED_SECRET')
  })
})

describe('versioned contract and proxy boundaries', () => {
  const ok = () => vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: JSON.stringify(marketingResult) } }] }))
  it('serves both the versioned and legacy paths and advertises the version', async () => {
    for (const path of ['/api/v1/status', '/api/status']) {
      const response = await handleRequest(new Request(`https://example.test${path}`), { env })
      expect(response.status).toBe(200)
      expect(response.headers.get('x-api-version')).toBe('v1')
    }
    const versioned = await handleRequest(new Request('https://example.test/api/v1/ai', { method: 'POST', headers: { 'content-type': 'application/json', 'x-lek-access': env.AI_ACCESS_CODE }, body: JSON.stringify({ tool: 'marketing', input: marketingExample, consent: true }) }), config(marketingResult, ok()))
    expect(versioned.status).toBe(200)
  })
  it('returns a contract error for an unknown path', async () => {
    const response = await handleRequest(new Request('https://example.test/api/v2/ai'), { env })
    expect(response.status).toBe(404)
    expect((await response.json()).error.code).toBe('method')
  })
  it('rejects a cross-origin caller until the origin is explicitly allowlisted', async () => {
    const setup = config(marketingResult, ok())
    const caller = { origin: 'https://owner.github.io', 'sec-fetch-site': 'cross-site' }
    expect((await handleRequest(request(undefined, caller), setup)).status).toBe(403)
    setup.env.AI_ALLOWED_ORIGINS = 'https://owner.github.io'
    const allowed = await handleRequest(request(undefined, caller), setup)
    expect(allowed.status).toBe(200)
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://owner.github.io')
    expect(allowed.headers.get('vary')).toBe('Origin')
  })
  it('never reflects an unlisted origin and still requires the access code', async () => {
    const setup = config(marketingResult, ok())
    setup.env.AI_ALLOWED_ORIGINS = 'https://owner.github.io'
    const response = await handleRequest(request(undefined, { origin: 'https://evil.test' }), setup)
    expect(response.status).toBe(403)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    const noCode = await handleRequest(request(undefined, { origin: 'https://owner.github.io', 'x-lek-access': 'wrong' }), setup)
    expect(noCode.status).toBe(401)
  })
  it('answers preflight only for allowlisted origins and ignores malformed entries', async () => {
    const setup = config(marketingResult, ok())
    setup.env.AI_ALLOWED_ORIGINS = 'https://owner.github.io, not-an-origin , javascript:alert(1)'
    const preflight = await handleRequest(new Request('https://example.test/api/v1/ai', { method: 'OPTIONS', headers: { origin: 'https://owner.github.io' } }), setup)
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe('https://owner.github.io')
    const denied = await handleRequest(new Request('https://example.test/api/v1/ai', { method: 'OPTIONS', headers: { origin: 'https://evil.test' } }), setup)
    expect(denied.status).toBe(403)
  })
  it('retries a transient provider limit once and then succeeds', async () => {
    let calls = 0
    const fetcher = vi.fn<typeof fetch>(async () => {
      calls++
      return calls === 1
        ? new Response('busy', { status: 429, headers: { 'retry-after': '1' } })
        : Response.json({ choices: [{ message: { content: JSON.stringify(marketingResult) } }] })
    })
    const response = await handleRequest(request(), config(marketingResult, fetcher))
    expect(response.status).toBe(200)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('caps the completion budget and honours a valid daily ceiling only', async () => {
    const setup = config(marketingResult, ok())
    setup.env.AI_MAX_TOKENS = '999999'
    expect((await handleRequest(request(), setup)).status).toBe(200)
    expect(JSON.parse(String(setup.fetcher.mock.calls[0][1]?.body)).max_completion_tokens).toBe(4096)
    const tuned = config(marketingResult, ok())
    tuned.env.AI_MAX_TOKENS = '2048'
    await handleRequest(request(), tuned)
    expect(JSON.parse(String(tuned.fetcher.mock.calls[0][1]?.body)).max_completion_tokens).toBe(2048)
  })
  it('falls back to the default provider when an unknown one is configured', async () => {
    const setup = config(marketingResult, ok())
    setup.env.AI_PROVIDER = 'does-not-exist'
    const response = await handleRequest(request(), setup)
    expect(response.status).toBe(200)
    expect(setup.fetcher.mock.calls[0][0]).toBe('https://api.groq.com/openai/v1/chat/completions')
  })
})
