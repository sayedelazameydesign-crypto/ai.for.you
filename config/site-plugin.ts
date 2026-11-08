import type { Plugin } from 'vite'
import type { SiteConfig } from '../shared/site.ts'

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

/**
 * Injects the resolved site identity into the HTML shell and defines the same
 * object for the app. Nothing here is a secret: only public branding and URLs.
 * A custom domain additionally needs a CNAME file in the published artifact.
 */
export function sitePlugin(config: SiteConfig, customDomain: string): Plugin {
  return {
    name: 'celia-site-identity',
    transformIndexHtml(html) {
      const canonical = config.siteUrl ? `<link rel="canonical" href="${escapeHtml(config.siteUrl)}" />` : ''
      const graph = config.siteUrl
        ? `<meta property="og:type" content="website" />\n    <meta property="og:title" content="${escapeHtml(config.title)}" />\n    <meta property="og:description" content="${escapeHtml(config.description)}" />\n    <meta property="og:url" content="${escapeHtml(config.siteUrl)}" />\n    <meta property="og:locale" content="ar_AR" />\n    <meta name="twitter:card" content="summary" />`
        : ''
      return html
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
