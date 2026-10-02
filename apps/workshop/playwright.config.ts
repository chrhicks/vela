import { defineConfig } from '@playwright/test'

const requestedPort = process.env.WORKSHOP_PORT ?? '5174'

const port = Number(requestedPort)

if (!/^\d+$/.test(requestedPort) || !Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('WORKSHOP_PORT must be an integer from 1 through 65535')

const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL,
    browserName: 'chromium',
  },
  webServer: {
    command: `pnpm exec vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
})
