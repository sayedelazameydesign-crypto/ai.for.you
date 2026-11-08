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
      // Measured on 2026-11-08, first before enforcement (68.22 / 67.19 /
      // 64.49 / 78.47), then again after the A3/A5/A11 fixes added their tests
      // (70.23 / 69.09 / 66.66 / 80.32). Thresholds were raised to sit just
      // under the new floor. Raise them when they are beaten; never lower them
      // to make a red build green.
      thresholds: {
        statements: 69,
        branches: 68,
        functions: 65,
        lines: 79,
      },
      // Generated and configuration-only files carry no logic worth gating.
      exclude: ['vite.config.ts', 'vitest.config.ts', 'playwright.config.ts', 'config/**', 'scripts/**'],
    },
  },
})
