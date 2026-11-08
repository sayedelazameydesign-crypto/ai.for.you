/**
 * Content Security Policy for celia.sh.
 *
 * A5 in docs/AUDIT.md: the app shipped without CSP. Nothing in `src/` uses
 * `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function`, so this is
 * defence in depth rather than the fix for a live XSS. That is exactly why it
 * must be tested before it is enforced: a policy strong enough to matter is
 * also strong enough to break a working app.
 *
 * The policy is derived from what the build actually ships:
 *
 *   - Fonts are bundled by Fontsource and served from the same origin, so
 *     `font-src 'self'` is enough and Google Fonts is never contacted.
 *   - Vite emits a single module script with no inline bootstrap for this app.
 *     `style-src` still needs `'unsafe-inline'` because React sets a few inline
 *     style attributes at runtime and Vite injects a stylesheet in dev; keeping
 *     it only on styles leaves script execution locked down.
 *   - `connect-src 'self'` covers the relative `/api/v1/*` calls. When an
 *     operator points the app at a separate API origin, that origin is added
 *     explicitly instead of opening `connect-src *`.
 *   - `frame-ancestors 'none'` blocks embedding and clickjacking.
 *
 * GitHub Pages cannot send custom headers at all. There the same policy is
 * delivered as a `<meta http-equiv>` tag, with the one directive that meta
 * cannot express (`frame-ancestors`) removed, because a meta policy that
 * contains it is ignored wholesale by some browsers.
 */

export interface CspOptions {
  /** Absolute origin of a separate API proxy, e.g. https://api.example.com */
  apiBase?: string
  /** Dev server needs permissive connect/script for HMR. Never used in prod. */
  dev?: boolean
}

const SHARED = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "img-src 'self' data:",
  "font-src 'self'",
  "manifest-src 'self'",
]

function connectSources(options: CspOptions): string {
  const sources = ["'self'"]
  if (options.apiBase) {
    try {
      sources.push(new URL(options.apiBase).origin)
    } catch {
      // An unparseable base is dropped; the app already falls back to same-origin.
    }
  }
  if (options.dev) sources.push('ws:', 'wss:')
  return `connect-src ${sources.join(' ')}`
}

/** Full header value, for platforms that can set headers (Vercel, nginx). */
export function contentSecurityPolicy(options: CspOptions = {}): string {
  const directives = [
    ...SHARED,
    options.dev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    connectSources(options),
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ]
  return directives.join('; ')
}

/**
 * The subset a `<meta http-equiv>` tag may carry.
 *
 * `frame-ancestors`, `report-uri` and `sandbox` are ignored in meta, so they are
 * removed rather than shipped and silently dropped.
 */
export function metaContentSecurityPolicy(options: CspOptions = {}): string {
  return contentSecurityPolicy(options)
    .split(';')
    .map((directive) => directive.trim())
    .filter((directive) => directive && !/^frame-ancestors\b/.test(directive))
    .join('; ')
}

/**
 * Static HTTP header policy for `vercel.json`.
 *
 * `vercel.json` is static in Git and cannot interpolate `VITE_API_BASE` at build
 * time. Because browsers enforce the intersection of every active CSP policy,
 * shipping a static `connect-src 'self'` (or a `default-src 'self'` fallback) in
 * `vercel.json` silently blocks an external `VITE_API_BASE` that `index.html`'s
 * build-resolved `<meta>` policy explicitly allowed.
 *
 * Keeping only the origin-invariant directives here enforces `frame-ancestors`
 * (which `<meta>` cannot express) and script/object/base/form lock-down at the
 * HTTP edge, while `index.html`'s `<meta>` policy enforces `default-src`,
 * `connect-src` (including `apiBase` when configured), `style-src`, `img-src`,
 * `font-src` and `manifest-src`.
 */
export function vercelHeaderContentSecurityPolicy(): string {
  return [
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "script-src 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join('; ')
}

/**
 * A second, independent layer for the two things CSP does not cover:
 * MIME sniffing and leaked referrers. Vercel sets these as headers; Pages
 * cannot, so they are also emitted as meta where the browser honours them.
 */
export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-Frame-Options': 'DENY',
} as const
