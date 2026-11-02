import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    env: {},
    globalSetup: ['./tools/testing/temp-guard.mts'],
    // Saved diagnostic reproductions and compiled baselines are evidence, not
    // current source tests. Keep them intact without rediscovering them here.
    exclude: [...configDefaults.exclude, '**/dist/**', '**/.local/**', 'data/**'],
  },
})
