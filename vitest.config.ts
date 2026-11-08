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
  },
})
