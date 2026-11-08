import { describe, expect, it } from 'vitest'
import { httpUrl, joinApiBase, resolveSiteConfig, SITE_DEFAULTS } from '../shared/site'
import { normalizeBase, normalizeDomain } from '../config/site-plugin'
import { apiPath, API_VERSION } from '../shared/contract'
import { TOOL_IDS } from '../shared/tools'
import { tools, toolById } from '../src/tools/index'
import { serverTools } from '../server/tools/index'

describe('hosting identity comes from the environment', () => {
  it('falls back to defaults when nothing is configured', () => {
    const config = resolveSiteConfig({})
    expect(config.brandLatin).toBe(SITE_DEFAULTS.brandLatin)
    expect(config.siteUrl).toBe(SITE_DEFAULTS.siteUrl)
    expect(config.apiBase).toBe('')
  })
  it('accepts a repository rename and a custom domain without code edits', () => {
    const renamed = resolveSiteConfig({ VITE_REPO_URL: 'https://github.com/owner/celia.sh', VITE_SITE_URL: 'https://owner.github.io/celia.sh/' })
    expect(renamed.repoUrl).toBe('https://github.com/owner/celia.sh')
    expect(renamed.siteUrl).toBe('https://owner.github.io/celia.sh/')
    const domain = resolveSiteConfig({ VITE_SITE_URL: 'https://celia.sh' })
    expect(domain.siteUrl).toBe('https://celia.sh/')
  })
  it('rejects non-http schemes, credentials and malformed URLs', () => {
    expect(httpUrl('javascript:alert(1)')).toBe('')
    expect(httpUrl('data:text/html,<script>')).toBe('')
    expect(httpUrl('https://user:pass@example.test')).toBe('')
    expect(httpUrl('not a url')).toBe('')
    expect(resolveSiteConfig({ VITE_SITE_URL: 'javascript:alert(1)' }).siteUrl).toBe(SITE_DEFAULTS.siteUrl)
    expect(resolveSiteConfig({ VITE_REPO_URL: 'ftp://example.test' }).repoUrl).toBe(SITE_DEFAULTS.repoUrl)
  })
  it('escapes nothing into the theme colour and keeps a valid hex only', () => {
    expect(resolveSiteConfig({ VITE_THEME_COLOR: 'red;background:url(x)' }).themeColor).toBe(SITE_DEFAULTS.themeColor)
    expect(resolveSiteConfig({ VITE_THEME_COLOR: '#aabbcc' }).themeColor).toBe('#aabbcc')
  })
  it('normalizes base and CNAME so a stray value cannot break the build', () => {
    expect(normalizeBase(undefined)).toBe('./')
    expect(normalizeBase('celia.sh')).toBe('/celia.sh/')
    expect(normalizeBase('/celia.sh/')).toBe('/celia.sh/')
    expect(normalizeBase('/')).toBe('/')
    expect(normalizeBase('///')).toBe('/')
    expect(normalizeDomain('celia.sh')).toBe('celia.sh')
    expect(normalizeDomain('https://celia.sh/path')).toBe('')
    expect(normalizeDomain('celia.sh; rm -rf /')).toBe('')
    expect(normalizeDomain('localhost')).toBe('')
  })
  it('keeps API URLs relative by default and absolute when a proxy is configured', () => {
    expect(joinApiBase('', apiPath('status'))).toBe(`api/${API_VERSION}/status`)
    expect(joinApiBase('https://proxy.test/', apiPath('ai'))).toBe(`https://proxy.test/api/${API_VERSION}/ai`)
  })
})

describe('tool registries stay in sync', () => {
  it('registers every shared id on both the client and the server', () => {
    expect(tools.map((tool) => tool.id)).toEqual([...TOOL_IDS])
    for (const id of TOOL_IDS) {
      expect(toolById.get(id)?.Page).toBeTypeOf('function')
      expect(serverTools.get(id)?.validateInput).toBeTypeOf('function')
    }
  })
  it('exposes the labels the shell renders', () => {
    for (const tool of tools) {
      expect(tool.action.length).toBeGreaterThan(0)
      expect(tool.notice.length).toBeGreaterThan(0)
      expect(tool.example.title.length).toBeGreaterThan(0)
    }
  })
})
