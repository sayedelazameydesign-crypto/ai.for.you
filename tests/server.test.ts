import { describe, expect, it, vi } from 'vitest'
import { handleRequest, isConfigured, validateRequest } from '../server/ai'
import { marketingExample } from '../src/lib/marketing'
import { summaryExample } from '../src/lib/summary'

const env = { GROQ_API_KEY: 'test-server-secret-not-real', AI_ACCESS_CODE: 'test-access-code', AI_DAILY_LIMIT: '40' }
let time = 1800000000000
function request(body: unknown = { tool: 'marketing', input: marketingExample, consent: true }, headers: Record<string, string> = {}) {
  return new Request('https://example.test/api/ai', { method: 'POST', headers: { 'content-type': 'application/json', 'x-lek-access': env.AI_ACCESS_CODE, ...headers }, body: JSON.stringify(body) })
}
function config(result: unknown, fetcher = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: JSON.stringify(result) } }] }))) {
  time += 61000
  return { env: { ...env }, fetcher, now: () => time }
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
})
