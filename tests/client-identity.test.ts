import { beforeEach, describe, expect, it } from 'vitest'
import { addressFromHeader, clientKey, normalizeAddress, SHARED_BUCKET, trustedProxy } from '../server/client-identity'
import { handleRequest, resetRateLimits } from '../server/ai'

const SECRET = 'test-access-code'
const env = { GROQ_API_KEY: 'test-server-secret-not-real', AI_ACCESS_CODE: SECRET }

const okFetcher = async () => Response.json({ choices: [{ message: { content: JSON.stringify({ variants: [{ id: 'v1', label: 'x', text: 'y' }] }) } }] })
const body = { tool: 'marketing', input: { product: 'أ', audience: 'ب', benefit: 'ج', platform: 'x', tone: 'friendly', language: 'ar' }, consent: true }

/** A request whose forwarding headers are entirely attacker-controlled. */
function spoofed(headers: Record<string, string>, url = 'https://example.test/api/v1/ai') {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-lek-access': SECRET, ...headers },
    body: JSON.stringify(body),
  })
}

const headersOf = (entries: Record<string, string>) => new Headers(entries)

describe('A3 — client identity cannot be chosen by the caller', () => {
  // The shared bucket is process-wide by design, so each case starts clean.
  beforeEach(() => resetRateLimits())

  it('uses one shared bucket when no trusted proxy is declared', () => {
    const a = clientKey(headersOf({ 'x-forwarded-for': '1.2.3.4' }), 'none')
    const b = clientKey(headersOf({ 'x-forwarded-for': '9.9.9.9' }), 'none')
    const c = clientKey(headersOf({}), 'none')
    expect(a).toBe(SHARED_BUCKET)
    expect(b).toBe(SHARED_BUCKET)
    expect(c).toBe(SHARED_BUCKET)
  })

  it('rotating X-Forwarded-For does not create a fresh bucket when the proxy is undeclared', async () => {
    const config = { env, fetcher: okFetcher as typeof fetch }
    const statuses: number[] = []
    // Each request claims a different visitor. A spoofable key would give each
    // one six fresh attempts; a shared bucket exhausts after six total.
    for (let i = 0; i < 8; i++) {
      statuses.push((await handleRequest(spoofed({ 'x-forwarded-for': `10.0.0.${i}` }), config)).status)
    }
    expect(statuses.filter((status) => status === 200)).toHaveLength(6)
    expect(statuses.filter((status) => status === 429)).toHaveLength(2)
  })

  it('ignores a header the operator did not declare', async () => {
    const config = { env: { ...env, AI_TRUSTED_PROXY: 'x-real-ip' }, fetcher: okFetcher as typeof fetch }
    const statuses: number[] = []
    for (let i = 0; i < 8; i++) {
      statuses.push((await handleRequest(spoofed({ 'x-forwarded-for': `10.0.0.${i}` }), config)).status)
    }
    // x-forwarded-for is not the declared source, so all eight share one key.
    expect(statuses.filter((status) => status === 200)).toHaveLength(6)
  })

  it('refuses an unrecognized proxy name instead of trusting it', () => {
    expect(trustedProxy('x-forwarded-for')).toBe('x-forwarded-for')
    expect(trustedProxy('  CF-Connecting-IP ')).toBe('cf-connecting-ip')
    for (const bad of ['', 'true', 'anything', 'X_FORWARDED_FOR', 'x-forwarded-for, x-real-ip', undefined]) {
      expect(trustedProxy(bad)).toBe('none')
    }
  })

  it('reads the last hop, not the first, when a proxy is declared', () => {
    // The caller prepends a fake address; the trusted edge appends the real one.
    const declared = addressFromHeader('203.0.113.9, 198.51.100.7', 'x-forwarded-for')
    expect(declared).toBe('198.51.100.7')
    // A single value still works.
    expect(addressFromHeader('198.51.100.7', 'x-forwarded-for')).toBe('198.51.100.7')
  })

  it('maps many forged prefixes to the same bucket when the declared hop is stable', () => {
    const proxy = trustedProxy('x-forwarded-for')
    const realEdge = '198.51.100.7'
    const keys = [0, 1, 2, 3].map((i) => clientKey(headersOf({ 'x-forwarded-for': `10.0.0.${i}, ${realEdge}` }), proxy))
    expect(new Set(keys).size).toBe(1)
  })

  it('falls back to the shared bucket rather than to a caller-controlled string', () => {
    const proxy = trustedProxy('x-forwarded-for')
    for (const garbage of ['', 'not-an-ip', '<script>', '1.2.3.4; DROP', 'x'.repeat(200)]) {
      expect(clientKey(headersOf({ 'x-forwarded-for': garbage }), proxy)).toBe(SHARED_BUCKET)
    }
  })

  it('never stores a raw address in the limiter key', () => {
    const key = clientKey(headersOf({ 'x-forwarded-for': '198.51.100.7' }), trustedProxy('x-forwarded-for'))
    expect(key).not.toContain('198.51.100.7')
    expect(key).toMatch(/^[0-9a-f]{32}$/)
  })

  it('only accepts address-shaped values, with or without a port', () => {
    expect(normalizeAddress('198.51.100.7')).toBe('198.51.100.7')
    expect(normalizeAddress('198.51.100.7:443')).toBe('198.51.100.7')
    expect(normalizeAddress('[2001:db8::1]:8080')).toBe('2001:db8::1')
    expect(normalizeAddress('2001:db8::1')).toBe('2001:db8::1')
    expect(normalizeAddress('')).toBe('')
    expect(normalizeAddress('localhost')).toBe('')
    expect(normalizeAddress('1.2.3')).toBe('')
  })

  it('keeps a caller-supplied identity working for tests and future auth', async () => {
    const config = { env, fetcher: okFetcher as typeof fetch }
    for (let i = 0; i < 6; i++) expect((await handleRequest(spoofed({}), config, `user-${i}-${Math.random()}`)).status).toBe(200)
  })
})
