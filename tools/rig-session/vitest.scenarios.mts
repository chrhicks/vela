import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from 'vitest/config'

// Scenarios start a whole rig of processes, so they are not part of `pnpm test`: run `pnpm scenarios`.
export default defineConfig({
  root: import.meta.dirname,
  cacheDir: join(tmpdir(), 'vela-scenarios-vite'),
  test: {
    include: ['src/**/*.scenario.ts'],
    testTimeout: 180_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
})
