import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolveSiteConfig } from './shared/site.ts'

export default defineConfig({
  plugins: [react()],
  define: { __SITE_CONFIG__: JSON.stringify(resolveSiteConfig({})) },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
    clearMocks: true,
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'text'],
      // Measured on 2026-11-08, before this file enforced anything:
      // statements 68.22%, branches 67.19%, functions 64.49%, lines 78.47%.
      // Thresholds sit just under the measured floor so they catch a real drop
      // without failing on unrelated refactors. Raise them when they are beaten;
      // never lower them to make a red build green.
      thresholds: {
        statements: 66,
        branches: 65,
        functions: 62,
        lines: 76,
      },
      // Generated and configuration-only files carry no logic worth gating.
      exclude: ['vite.config.ts', 'vitest.config.ts', 'playwright.config.ts', 'config/**', 'scripts/**'],
    },
  },
})
