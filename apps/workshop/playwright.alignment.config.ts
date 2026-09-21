import { defineConfig } from '@playwright/test'

// Dedicated Rift runtime: never reuse the primary workshop on 5174.
export default defineConfig({
  testDir: './tests',
  testMatch: 'alignment-inspection.e2e.ts',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5184', browserName: 'chromium' },
  webServer: {
    command: 'pnpm exec vite --port 5184 --strictPort',
    url: 'http://127.0.0.1:5184',
    reuseExistingServer: !process.env.CI,
  },
})
