import { createRequire } from 'node:module'
import { expect, it } from 'vitest'

// Two copies of Effect would break Schema and tagged-error checks across the seam with Cria's packages.
function effectSeenFrom(module: string) {
  const require = createRequire(module)
  const path = require.resolve('effect/package.json')

  return { path, version: require(path).version }
}

it('shares one copy of Effect 4.0.3 with @cria/primitives and @cria/wire', () => {
  const vela = effectSeenFrom(import.meta.url)

  expect(vela.version).toBe('4.0.3')
  expect(effectSeenFrom(import.meta.resolve('@cria/primitives'))).toEqual(vela)
  expect(effectSeenFrom(import.meta.resolve('@cria/wire'))).toEqual(vela)
})
