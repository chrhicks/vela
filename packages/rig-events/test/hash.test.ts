import { describe, expect, it } from 'vitest'
import { canonicalJson, fnv1a64 } from '@vela/rig-events'

describe('canonicalJson', () => {
  it('writes the same bytes whatever order the keys were built in', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } })).toBe(canonicalJson({ a: { c: null, d: [1, { y: 2, z: 1 }] }, b: 1 }))
  })

  it('drops undefined object members and keeps array slots', () => {
    expect(canonicalJson({ a: undefined, b: [undefined, 1] })).toBe('{"b":[null,1]}')
  })
})

describe('fnv1a64', () => {
  it('matches the published FNV-1a 64 test vectors', () => {
    expect(fnv1a64('')).toBe('cbf29ce484222325')
    expect(fnv1a64('a')).toBe('af63dc4c8601ec8c')
    expect(fnv1a64('foobar')).toBe('85944171f73967e8')
  })
})
