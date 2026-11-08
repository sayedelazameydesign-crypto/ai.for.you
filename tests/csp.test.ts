import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contentSecurityPolicy, metaContentSecurityPolicy, SECURITY_HEADERS, vercelHeaderContentSecurityPolicy } from '../config/security-headers'

const directives = (policy: string) => policy.split(';').map((part) => part.trim()).filter(Boolean)
const directive = (policy: string, name: string) => directives(policy).find((part) => part.startsWith(`${name} `))

/** Evaluate whether a fetch target is permitted by a single CSP policy (connect-src -> default-src). */
function allowsConnect(policy: string, targetOrigin: string, selfOrigin = 'https://celia.sh'): boolean {
  const effective = directive(policy, 'connect-src') ?? directive(policy, 'default-src')
  if (!effective) return true // CSP3: absent connect-src and absent default-src imposes no connect restriction.
  const tokens = effective.split(/\s+/).slice(1)
  return tokens.some((token) => (token === "'self'" ? targetOrigin === selfOrigin : token === targetOrigin))
}

describe('A5 — content security policy', () => {
  it('locks script execution to same-origin bundles in production', () => {
    const policy = contentSecurityPolicy()
    expect(directive(policy, 'script-src')).toBe("script-src 'self'")
    // The dangerous relaxation must not appear anywhere in a production policy.
    expect(policy).not.toContain("'unsafe-eval'")
    expect(directive(policy, 'script-src')).not.toContain("'unsafe-inline'")
  })

  it('forbids plugins, framing and base hijacking', () => {
    const policy = contentSecurityPolicy()
    expect(directive(policy, 'object-src')).toBe("object-src 'none'")
    expect(directive(policy, 'frame-ancestors')).toBe("frame-ancestors 'none'")
    expect(directive(policy, 'base-uri')).toBe("base-uri 'self'")
    expect(directive(policy, 'form-action')).toBe("form-action 'self'")
  })

  it('keeps the app working: fonts and images from the build, no third party', () => {
    const policy = contentSecurityPolicy()
    // Fontsource ships the fonts; Google Fonts must never be required.
    expect(directive(policy, 'font-src')).toBe("font-src 'self'")
    expect(directive(policy, 'img-src')).toBe("img-src 'self' data:")
    expect(policy).not.toContain('fonts.googleapis.com')
    expect(policy).not.toContain('fonts.gstatic.com')
  })

  it('allows the relative API call the app actually makes', () => {
    expect(directive(contentSecurityPolicy(), 'connect-src')).toBe("connect-src 'self'")
  })

  it('adds a configured API origin explicitly instead of opening the policy', () => {
    const policy = contentSecurityPolicy({ apiBase: 'https://api.example.com' })
    expect(directive(policy, 'connect-src')).toBe("connect-src 'self' https://api.example.com")
    expect(policy).not.toContain('connect-src *')
  })

  it('ignores an unparseable API base rather than widening the policy', () => {
    const policy = contentSecurityPolicy({ apiBase: 'not a url' })
    expect(directive(policy, 'connect-src')).toBe("connect-src 'self'")
  })

  it('permits HMR only when explicitly running the dev server', () => {
    const dev = contentSecurityPolicy({ dev: true })
    expect(dev).toContain('ws:')
    expect(contentSecurityPolicy()).not.toContain('ws:')
  })

  it('drops frame-ancestors from the meta variant, which browsers ignore there', () => {
    const meta = metaContentSecurityPolicy()
    expect(meta).not.toContain('frame-ancestors')
    // Everything a meta tag can enforce is still present.
    expect(meta).toContain("default-src 'self'")
    expect(meta).toContain("script-src 'self'")
    expect(meta).toContain("connect-src 'self'")
  })

  it('keeps the supporting headers, including clickjacking protection', () => {
    expect(SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff')
    expect(SECURITY_HEADERS['X-Frame-Options']).toBe('DENY')
    expect(SECURITY_HEADERS['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
  })

  it('keeps vercel.json synchronized with the static edge policy so VITE_API_BASE is never blocked', () => {
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
      headers: { source: string; headers: { key: string; value: string }[] }[]
    }
    const header = vercel.headers
      .flatMap((rule) => rule.headers)
      .find((entry) => entry.key === 'Content-Security-Policy')?.value
    expect(header).toBe(vercelHeaderContentSecurityPolicy())
    expect(directive(header!, 'frame-ancestors')).toBe("frame-ancestors 'none'")
    expect(directive(header!, 'script-src')).toBe("script-src 'self'")
    expect(directive(header!, 'connect-src')).toBeUndefined()
    expect(directive(header!, 'default-src')).toBeUndefined()
  })

  it('allows a configured VITE_API_BASE across the intersected Vercel header and HTML meta policies', () => {
    const edgeHeader = vercelHeaderContentSecurityPolicy()
    const defaultPolicies = [edgeHeader, metaContentSecurityPolicy()]
    expect(defaultPolicies.every((p) => allowsConnect(p, 'https://celia.sh'))).toBe(true)
    expect(defaultPolicies.every((p) => allowsConnect(p, 'https://api.example.com'))).toBe(false)

    const splitApiPolicies = [edgeHeader, metaContentSecurityPolicy({ apiBase: 'https://api.example.com' })]
    expect(splitApiPolicies.every((p) => allowsConnect(p, 'https://celia.sh'))).toBe(true)
    expect(splitApiPolicies.every((p) => allowsConnect(p, 'https://api.example.com'))).toBe(true)
    expect(splitApiPolicies.every((p) => allowsConnect(p, 'https://evil.test'))).toBe(false)
  })
})

describe('A5 — the dev policy can never reach production', () => {
  it('publishes a strict script-src in the built artifact', async () => {
    const { existsSync, readFileSync } = await import('node:fs')
    if (!existsSync('dist/index.html')) return // check-build enforces this in CI
    const html = readFileSync('dist/index.html', 'utf8')
    const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1]
      ?.replaceAll('&#39;', "'")
    expect(policy).toBeTruthy()
    expect(policy).not.toContain("'unsafe-eval'")
    expect(policy).not.toContain('ws:')
    expect(policy).toMatch(/script-src 'self'(;|$)/)
  })
})
