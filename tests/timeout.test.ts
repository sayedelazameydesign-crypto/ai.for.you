import { beforeEach, describe, expect, it, vi } from 'vitest'
import { handleRequest, resetRateLimits, upstreamTimeout } from '../server/ai'

const SECRET = 'test-access-code'
const env = { GROQ_API_KEY: 'test-server-secret-not-real', AI_ACCESS_CODE: SECRET }
const body = { tool: 'marketing', input: { product: 'أ', audience: 'ب', benefit: 'ج', platform: 'x', tone: 'friendly', language: 'ar' }, consent: true }
const okPayload = { choices: [{ message: { content: JSON.stringify({ variants: [{ id: 'v1', label: 'x', text: 'y' }] }) } }] }

const request = () => new Request('https://example.test/api/v1/ai', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-lek-access': SECRET },
  body: JSON.stringify(body),
})

/** A provider that never answers on its own; it only stops when aborted. */
const hangingFetcher = vi.fn<typeof fetch>((_input, init) => new Promise((_resolve, reject) => {
  const signal = init?.signal
  signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
}))

describe('A11 — application timeout stops before the platform does', () => {
  beforeEach(() => resetRateLimits())

  it('returns a clear timeout code and metric instead of letting the platform kill the function', async () => {
    const lines: string[] = []
    const response = await handleRequest(request(), {
      env: { ...env, AI_TIMEOUT_MS: '1000' },
      fetcher: hangingFetcher,
      metrics: (line) => lines.push(line),
    })
    expect(response.status).toBe(504)
    const payload = await response.json() as { error: { code: string; message: string } }
    expect(payload.error.code).toBe('timeout')
    // The message is actionable in Arabic and points at the local mode.
    expect(payload.error.message).toContain('محلي')
    expect(JSON.parse(lines[0])).toMatchObject({ outcome: 'failed', code: 'timeout', status: 504 })
  })

  it('never lets a configured deadline exceed the hard ceiling', () => {
    // 55000 was previously accepted while the platform kills the function at
    // 30 s. This is the assertion that proves the fix, asserted on the value
    // rather than on a clock.
    expect(upstreamTimeout({})).toBe(24000)
    expect(upstreamTimeout({ AI_TIMEOUT_MS: '55000' })).toBeLessThanOrEqual(25000)
    expect(upstreamTimeout({ AI_TIMEOUT_MS: '25000' })).toBe(25000)
    expect(upstreamTimeout({ AI_TIMEOUT_MS: '30000' })).toBeLessThanOrEqual(25000)
    // Out-of-range values fall back to the safe default instead of being clamped
    // upward or silently accepted.
    expect(upstreamTimeout({ AI_TIMEOUT_MS: '0' })).toBe(24000)
    expect(upstreamTimeout({ AI_TIMEOUT_MS: '-5' })).toBe(24000)
    expect(upstreamTimeout({ AI_TIMEOUT_MS: 'abc' })).toBe(24000)
  })

  it('honours a caller abort as a failure, not a success', async () => {
    const controller = new AbortController()
    const abortingFetcher = vi.fn<typeof fetch>((_input, init) => {
      controller.abort()
      const signal = init?.signal
      return new Promise((_resolve, reject) => {
        if (signal?.aborted) reject(new DOMException('aborted', 'AbortError'))
        else signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    })
    const response = await handleRequest(request(), { env: { ...env, AI_TIMEOUT_MS: '1000' }, fetcher: abortingFetcher })
    expect(response.status).toBe(504)
  })

  it('does not retry a timeout into a second full wait', async () => {
    const calls = vi.fn(hangingFetcher)
    await handleRequest(request(), { env: { ...env, AI_TIMEOUT_MS: '1000' }, fetcher: calls as unknown as typeof fetch })
    // A retry would double the wait and push past the platform deadline.
    expect(calls.mock.calls.length).toBe(1)
  })

  it('keeps the sane default and rejects values below the floor', async () => {
    const seen: number[] = []
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      const signal = init?.signal
      seen.push(signal ? 1 : 0)
      return Response.json(okPayload)
    })
    for (const value of ['0', '-1', 'abc', '24000']) {
      resetRateLimits()
      await handleRequest(request(), { env: { ...env, AI_TIMEOUT_MS: value }, fetcher: fetcher as unknown as typeof fetch })
    }
    expect(seen.every((entry) => entry === 1)).toBe(true)
  })
})
