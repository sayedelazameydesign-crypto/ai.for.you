/**
 * Trusted client identity.
 *
 * The rate limiter is only as honest as the key it is given. A header the
 * caller can write freely is not an identity: `X-Forwarded-For` is
 * client-controlled in every hop before the first trusted proxy, so reading
 * its first element lets anyone reset their bucket by sending a new value.
 *
 * The rule implemented here is that identity comes from a *declared* source,
 * never from a guess:
 *
 *   - `AI_TRUSTED_PROXY=none` (default) — the platform does not forward a
 *     client address, so every request shares one bucket. This is the safe
 *     default: it can throttle a whole deployment, but it cannot be defeated
 *     by a header, and it cannot silently pretend to distinguish clients.
 *   - `AI_TRUSTED_PROXY=<header>` — the operator names the header their
 *     platform sets, and the value is taken from the *last* element, because
 *     a proxy appends the address it saw and everything before it may be
 *     attacker-supplied. Vercel, Cloudflare and nginx all append, so the last
 *     element is the address the trusted edge observed.
 *
 * An unknown header name is refused rather than trusted, so a typo cannot turn
 * into "trust anything". Values are normalized: trimmed, bounded, stripped of
 * anything that is not an address or a token, and hashed before use, so the
 * limiter never holds a raw address in memory.
 */
import { createHash } from 'node:crypto'
import { isIP } from 'node:net'

export type TrustedProxy = 'none' | 'x-forwarded-for' | 'x-real-ip' | 'cf-connecting-ip' | 'x-vercel-forwarded-for'

export const TRUSTED_PROXIES: readonly TrustedProxy[] = ['none', 'x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'x-vercel-forwarded-for']

/** Resolve the declared proxy. Anything unrecognized means "trust nothing". */
export function trustedProxy(raw: string | undefined): TrustedProxy {
  const value = (raw ?? '').trim().toLowerCase()
  return (TRUSTED_PROXIES as readonly string[]).includes(value) ? value as TrustedProxy : 'none'
}

/**
 * A single deployment-wide bucket. Chosen deliberately over a per-request
 * random key: a random key would give every request its own bucket, which is
 * the vulnerability this module exists to remove.
 */
export const SHARED_BUCKET = 'shared'

/**
 * Pick the observed address out of a forwarding header.
 *
 * Only the last element is considered for append-style headers. A header that
 * contains no valid-looking address yields `''`, and the caller falls back to
 * the shared bucket rather than to a caller-controlled value.
 */
export function addressFromHeader(header: string | null | undefined, proxy: TrustedProxy): string {
  if (!header || proxy === 'none') return ''
  // Vercel documents x-vercel-forwarded-for as append-style like X-Forwarded-For.
  const parts = header.split(',').map((part) => part.trim()).filter(Boolean)
  const candidate = parts[parts.length - 1] ?? ''
  if (!candidate) return ''
  return normalizeAddress(candidate)
}

/**
 * Accept IPv4, IPv6, and either form with a port. Nothing else.
 *
 * Validation delegates to `net.isIP`, which is authoritative. Pattern matching
 * was tried first and it accepted `1.2.3`, which is exactly the class of
 * near-miss that makes a "sanitized" header still spoofable: a caller only
 * needs any value the limiter treats as distinct.
 */
export function normalizeAddress(value: string): string {
  const trimmed = value.trim().slice(0, 64)
  if (!trimmed) return ''
  const bracketed = /^\[([^\]]{3,45})\](?::\d{1,5})?$/.exec(trimmed)
  if (bracketed && isIP(bracketed[1]) !== 0) return bracketed[1].toLowerCase()
  if (isIP(trimmed) !== 0) return trimmed.toLowerCase()
  // Host:port, but only when the host itself is a valid address.
  const withPort = /^(.{3,45}):\d{1,5}$/.exec(trimmed)
  if (withPort && isIP(withPort[1]) !== 0) return withPort[1].toLowerCase()
  return ''
}

/**
 * The key the limiter sees. Addresses are hashed so that the in-memory bucket
 * map never stores personal data, and so that a log or heap dump of counters
 * reveals nothing.
 */
export function clientKey(headers: Headers, proxy: TrustedProxy): string {
  const address = addressFromHeader(headers.get(proxy === 'none' ? '__none__' : proxy), proxy)
  if (proxy === 'none' || !address) return SHARED_BUCKET
  return createHash('sha256').update(address).digest('hex').slice(0, 32)
}
