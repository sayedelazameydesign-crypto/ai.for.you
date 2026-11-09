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
    build: {
      target: 'es2022',
      sourcemap: false,
      // `three` is isolated into an on-demand lazy chunk (~580 kB raw / ~145 kB gzip)
      // and gated by compressed-byte budgets in scripts/check-build.mjs.
      chunkSizeWarningLimit: 620,
      // Keep font subsets as same-origin files so strict `font-src 'self'` is
      // never violated by Vite base64-inlining <4 KB unicode-range subsets into CSS.
      assetsInlineLimit: (filePath) => /\.(?:woff2?|ttf|otf)$/i.test(filePath) ? false : undefined,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/three')) return 'three'
          },
        },
      },
    },
  }
})
