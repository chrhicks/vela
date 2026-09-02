import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveRigCatalogPath } from './catalog-path.js'

describe('Rig catalog path', () => {
  it('anchors the default to the repository and resolves an explicit override', () => {
    expect(resolveRigCatalogPath(undefined)).toBe(
      fileURLToPath(new URL('../../../../data/rigs.yaml', import.meta.url)),
    )
    expect(resolveRigCatalogPath('local/rigs.yaml')).toBe(
      resolve('local/rigs.yaml'),
    )
  })
})
