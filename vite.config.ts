import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolveServerEnv } from './server/ai.ts'
import { developmentApi } from './server/development.ts'
import { resolveSiteConfig } from './shared/site.ts'
import { normalizeBase, normalizeDomain, sitePlugin } from './config/site-plugin.ts'

export default defineConfig(({ mode, command }) => {
  // Unprefixed secrets stay in this server closure; never pass them to define.
  const env = loadEnv(mode, process.cwd(), '')
  const merged = { ...process.env, ...env }
  const serverEnv = resolveServerEnv(env, process.env)
  const site = resolveSiteConfig(merged)
  const customDomain = normalizeDomain(merged.SITE_CNAME)
  return {
    base: normalizeBase(merged.SITE_BASE),
    configLoader: 'runner',
    // Only public identity is defined. No credential is ever reachable from here.
    define: { __SITE_CONFIG__: JSON.stringify(site) },
    plugins: [react(), tailwindcss(), sitePlugin(site, customDomain, command === 'serve'), {
      name: 'celia-private-ai-api',
      configureServer(server) { server.middlewares.use(developmentApi(serverEnv)) },
      configurePreviewServer(server) { server.middlewares.use(developmentApi(serverEnv)) },
    }],
    server: { host: '0.0.0.0', allowedHosts: ['.e2b.app', 'localhost', '127.0.0.1'] },
    preview: { host: '0.0.0.0', allowedHosts: ['.e2b.app', 'localhost', '127.0.0.1'] },
    build: { target: 'es2022', sourcemap: false },
  }
})
