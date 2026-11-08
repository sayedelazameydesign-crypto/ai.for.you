/**
 * Every value that depends on where the app is hosted lives here and comes from
 * the environment. Nothing in the UI hardcodes a repository name or a page path,
 * so renaming the repository or moving to a custom domain needs no code edit:
 * CI injects the real values from the GitHub context on every deploy.
 */
export interface SiteConfig {
  brandAr: string
  brandLatin: string
  title: string
  description: string
  /** Absolute https URL of the source repository, no trailing slash. */
  repoUrl: string
  /** Absolute canonical URL of the published site, with a trailing slash. '' when unknown. */
  siteUrl: string
  /** Absolute origin of a separate API proxy, no trailing slash. '' means same origin. */
  apiBase: string
  themeColor: string
}

export const SITE_DEFAULTS = {
  brandAr: 'لك',
  brandLatin: 'celia.sh',
  description: 'celia.sh — مساحة عربية لأدوات ذكية. اكتب محتوى تسويقياً، لخّص النصوص، وافحص أكوادك. أدوات محلية مجانية، دون حساب أو بطاقة ائتمان.',
  repoUrl: 'https://github.com/sayedelazameydesign-crypto/celia.sh',
  siteUrl: 'https://sayedelazameydesign-crypto.github.io/celia.sh/',
  themeColor: '#7660d3',
} as const

type Env = Record<string, string | undefined>

const clean = (value: string | undefined): string => typeof value === 'string' ? value.trim() : ''

/** Accept only http(s) absolute URLs. Anything else is dropped, never rendered. */
export function httpUrl(value: string | undefined): string {
  const raw = clean(value)
  if (!raw) return ''
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return ''
    if (url.username || url.password) return ''
    return url.toString()
  } catch { return '' }
}

const withTrailingSlash = (value: string): string => value ? value.endsWith('/') ? value : `${value}/` : ''
const withoutTrailingSlash = (value: string): string => value.replace(/\/+$/, '')

export function resolveSiteConfig(env: Env): SiteConfig {
  const brandAr = clean(env.VITE_BRAND_AR) || SITE_DEFAULTS.brandAr
  const brandLatin = clean(env.VITE_BRAND_LATIN) || SITE_DEFAULTS.brandLatin
  const description = clean(env.VITE_SITE_DESCRIPTION) || SITE_DEFAULTS.description
  const repoUrl = withoutTrailingSlash(httpUrl(env.VITE_REPO_URL)) || SITE_DEFAULTS.repoUrl
  const siteUrl = withTrailingSlash(httpUrl(env.VITE_SITE_URL)) || SITE_DEFAULTS.siteUrl
  const apiBase = withoutTrailingSlash(httpUrl(env.VITE_API_BASE))
  const themeColor = /^#[0-9a-f]{6}$/i.test(clean(env.VITE_THEME_COLOR)) ? clean(env.VITE_THEME_COLOR) : SITE_DEFAULTS.themeColor
  const title = clean(env.VITE_SITE_TITLE) || `${brandLatin} — أدوات ذكية، لاحتمالات أكبر`
  return { brandAr, brandLatin, title, description, repoUrl, siteUrl, apiBase, themeColor }
}

/** Join a configured API base with a contract path. Empty base keeps relative URLs. */
export function joinApiBase(base: string, path: string): string {
  const trimmed = withoutTrailingSlash(clean(base))
  return trimmed ? `${trimmed}/${path.replace(/^\/+/, '')}` : path
}
