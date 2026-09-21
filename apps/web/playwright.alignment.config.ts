import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: ['alignment.e2e.ts', 'alignment-inspection.e2e.ts', 'exposure-recovery.e2e.ts'],
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5190', browserName: 'chromium' },
  webServer: {
    command: 'pnpm exec vite --host 127.0.0.1 --port 5190 --strictPort',
    url: 'http://127.0.0.1:5190',
    reuseExistingServer: !process.env.CI,
  },
})
