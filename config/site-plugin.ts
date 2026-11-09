import type { Plugin } from 'vite'
import type { SiteConfig } from '../shared/site.ts'
import { metaContentSecurityPolicy, SECURITY_HEADERS } from './security-headers.ts'

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

/**
 * Injects the resolved site identity into the HTML shell and defines the same
 * object for the app. Nothing here is a secret: only public branding and URLs.
 * A custom domain additionally needs a CNAME file in the published artifact.
 *
 * `dev` matters for the CSP: Vite's dev server injects an inline React Refresh
 * preamble and needs eval, so the production policy would break the app while
 * developing it. The dev policy is deliberately separate and is never emitted
 * into a build.
 */
export function sitePlugin(config: SiteConfig, customDomain: string, dev = false): Plugin {
  return {
    name: 'celia-site-identity',
    transformIndexHtml(html) {
      const canonical = config.siteUrl ? `<link rel="canonical" href="${escapeHtml(config.siteUrl)}" />` : ''
      // og:image must be absolute, so it is only emitted when a site URL is known.
      // The card is PNG because most social scrapers ignore SVG.
      const image = config.siteUrl ? new URL('og-image.png', config.siteUrl).href : ''
      const graph = config.siteUrl
        ? `<meta property="og:type" content="website" />\n    <meta property="og:site_name" content="${escapeHtml(config.brandLatin)}" />\n    <meta property="og:title" content="${escapeHtml(config.title)}" />\n    <meta property="og:description" content="${escapeHtml(config.description)}" />\n    <meta property="og:url" content="${escapeHtml(config.siteUrl)}" />\n    <meta property="og:locale" content="ar_AR" />\n    <meta property="og:image" content="${escapeHtml(image)}" />\n    <meta property="og:image:width" content="1200" />\n    <meta property="og:image:height" content="630" />\n    <meta property="og:image:alt" content="${escapeHtml(config.brandLatin)}" />\n    <meta name="twitter:card" content="summary_large_image" />\n    <meta name="twitter:title" content="${escapeHtml(config.title)}" />\n    <meta name="twitter:description" content="${escapeHtml(config.description)}" />\n    <meta name="twitter:image" content="${escapeHtml(image)}" />`
        : ''
      // GitHub Pages cannot send custom headers, so the full build-resolved
      // policy (including any VITE_API_BASE connect-src origin) is emitted as a
      // meta tag. Vercel adds a complementary static header in vercel.json for
      // directives meta cannot express (such as frame-ancestors 'none') without
      // overriding connect-src.
      const meta = [
        `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(metaContentSecurityPolicy({ apiBase: config.apiBase, dev }))}" />`,
        // Only the two directives a meta tag actually supports. X-Frame-Options
        // and Permissions-Policy are ignored as meta, so shipping them there
        // would be decoration; they are sent as real headers on Vercel.
        ...['X-Content-Type-Options', 'Referrer-Policy'].map((name) =>
          `<meta http-equiv="${name}" content="${escapeHtml(SECURITY_HEADERS[name as keyof typeof SECURITY_HEADERS])}" />`),
      ].join('\n    ')
      return html
        .replace('<!-- security-headers -->', meta)
        .replaceAll('__TITLE__', escapeHtml(config.title))
        .replaceAll('__DESCRIPTION__', escapeHtml(config.description))
        .replaceAll('__THEME_COLOR__', escapeHtml(config.themeColor))
        .replace('<!-- canonical-url -->', canonical)
        .replace('<!-- open-graph -->', graph)
    },
    generateBundle() {
      if (!customDomain) return
      this.emitFile({ type: 'asset', fileName: 'CNAME', source: `${customDomain}\n` })
    },
  }
}

/** Only a bare hostname is accepted, so a stray URL or path cannot poison CNAME. */
export function normalizeDomain(value: string | undefined): string {
  const raw = (value ?? '').trim().toLowerCase()
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(raw) ? raw : ''
}

/** Vite base: relative by default so any subpath or domain root works unchanged. */
export function normalizeBase(value: string | undefined): string {
  const raw = (value ?? '').trim()
  if (!raw || raw === './') return './'
  if (/^https?:\/\//.test(raw)) return raw.endsWith('/') ? raw : `${raw}/`
  const segment = raw.replace(/^\/+|\/+$/g, '')
  // A bare '/' must stay '/', not become '//', which browsers read as a protocol-relative URL.
  return segment ? `/${segment}/` : '/'
}
