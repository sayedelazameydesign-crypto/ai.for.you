import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { developmentApi } from './server/development.ts'
import { resolveSiteConfig } from './shared/site.ts'
import { normalizeBase, normalizeDomain, sitePlugin } from './build/site-plugin.ts'

export default defineConfig(({ mode }) => {
  // Unprefixed secrets stay in this server closure; never pass them to define.
  const env = loadEnv(mode, process.cwd(), '')
  const merged = { ...process.env, ...env }
  const serverEnv = {
    GROQ_API_KEY: env.GROQ_API_KEY || process.env.GROQ_API_KEY,
    GROQ_MODEL: env.GROQ_MODEL || process.env.GROQ_MODEL,
    AI_ACCESS_CODE: env.AI_ACCESS_CODE || process.env.AI_ACCESS_CODE,
    AI_DAILY_LIMIT: env.AI_DAILY_LIMIT || process.env.AI_DAILY_LIMIT,
  }
  const site = resolveSiteConfig(merged)
  const customDomain = normalizeDomain(merged.SITE_CNAME)
  return {
    base: normalizeBase(merged.SITE_BASE),
    configLoader: 'runner',
    // Only public identity is defined. No credential is ever reachable from here.
    define: { __SITE_CONFIG__: JSON.stringify(site) },
    plugins: [react(), tailwindcss(), sitePlugin(site, customDomain), {
      name: 'celia-private-ai-api',
      configureServer(server) { server.middlewares.use(developmentApi(serverEnv)) },
      configurePreviewServer(server) { server.middlewares.use(developmentApi(serverEnv)) },
    }],
    server: { host: '0.0.0.0', allowedHosts: ['.e2b.app', 'localhost', '127.0.0.1'] },
    preview: { host: '0.0.0.0', allowedHosts: ['.e2b.app', 'localhost', '127.0.0.1'] },
    build: { target: 'es2022', sourcemap: false },
  }
})
