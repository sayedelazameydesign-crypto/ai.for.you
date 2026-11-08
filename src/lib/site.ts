import { resolveSiteConfig, joinApiBase, type SiteConfig } from '../../shared/site'
import { apiPath, type ApiEndpoint } from '../../shared/contract'

declare const __SITE_CONFIG__: SiteConfig | undefined

// Injected at build time by vite.config.ts (and vitest.config.ts). The fallback
// keeps direct module imports and unit tests working without a build step.
const config: SiteConfig = typeof __SITE_CONFIG__ === 'undefined' ? resolveSiteConfig({}) : __SITE_CONFIG__

export const site: SiteConfig = config

/**
 * Resolve an API endpoint. With no configured base the URL stays relative to the
 * document, so a GitHub Pages subpath and a custom domain both work unchanged.
 */
export function apiUrl(endpoint: ApiEndpoint): URL {
  const path = joinApiBase(site.apiBase, apiPath(endpoint))
  const base = typeof document === 'undefined' ? 'http://localhost/' : document.baseURI
  return new URL(path, site.apiBase ? `${site.apiBase}/` : base)
}
