import { describe, expect, it } from 'vitest'
import { findRow, normalised, searchCatalog } from './search.ts'

describe('catalog search', () => {
  it('ignores case, spaces and the zero padding of catalog numbers', () => {
    expect(normalised('NGC0224')).toBe('ngc224')
    expect(normalised('NGC 224')).toBe('ngc224')
    expect(normalised('M 31')).toBe('m31')
    expect(normalised('B033')).toBe('b33')
    expect(normalised('NGC 7000')).toBe('ngc7000')
    expect(normalised('NGC 1000')).toBe('ngc1000')
  })

  it.each(['M31', 'm 31', 'NGC 224', 'ngc0224', 'andromeda galaxy'])('finds the Andromeda Galaxy first for %s', query => {
    expect(searchCatalog(query, 10)[0]).toMatchObject({ id: 'ngc0224', name: 'NGC 224', commonName: 'Andromeda Galaxy', type: 'Galaxy', constellation: 'Andromeda' })
  })

  it('finds a target by part of its common name', () => {
    expect(searchCatalog('horsehead', 10).map(found => found.id)).toContain('b033')
    expect(searchCatalog('orion nebula', 10).map(found => found.id)).toContain('ngc1976')
  })

  it('lists an exact match before names that only start with the text', () => {
    const ids = searchCatalog('m3', 10).map(found => found.id)

    expect(findRow(ids[0] ?? '')?.[3]).toContain('M 3')
  })

  it('stops at the number of results asked for', () => {
    expect(searchCatalog('ngc', 7)).toHaveLength(7)
    expect(searchCatalog('ngc', 3)).toHaveLength(3)
  })

  it('finds nothing for text that is empty or matches no name', () => {
    expect(searchCatalog('', 10)).toEqual([])
    expect(searchCatalog('  - ', 10)).toEqual([])
    expect(searchCatalog('zzzzqqq', 10)).toEqual([])
  })

  it('finds a row by id', () => {
    expect(findRow('ngc0224')?.[1]).toBe('NGC 224')
    expect(findRow('nope')).toBeUndefined()
  })
})
