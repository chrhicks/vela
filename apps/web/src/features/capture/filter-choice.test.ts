import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { filterLabel, listedFilter, rememberedFilter, rememberFilter } from './filter-choice'

const filters = [
  { name: 'L-Ultimate', description: 'Optolong L-Ultimate, dual-band H-alpha + OIII, 3 nm' },
  { name: 'UV/IR cut' },
]

describe('capture filter choice', () => {
  beforeEach(() => {
    const data = new Map<string, string>()

    vi.stubGlobal('localStorage', {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('remembers the last choice for each rig on its own', () => {
    rememberFilter('rig-1', 'L-Ultimate')
    rememberFilter('rig-2', 'UV/IR cut')

    expect(rememberedFilter('rig-1')).toBe('L-Ultimate')
    expect(rememberedFilter('rig-2')).toBe('UV/IR cut')
    expect(rememberedFilter('rig-3')).toBeNull()
  })

  it('forgets a filter when None is chosen', () => {
    rememberFilter('rig-1', 'L-Ultimate')
    rememberFilter('rig-1', null)

    expect(rememberedFilter('rig-1')).toBeNull()
  })

  it('falls back to None for a remembered name the rig no longer lists', () => {
    expect(listedFilter('L-Ultimate', filters)).toBe('L-Ultimate')
    expect(listedFilter('Ha 7nm', filters)).toBeNull()
    expect(listedFilter(null, filters)).toBeNull()
  })

  it('shows the description beside the name only when there is one', () => {
    expect(filterLabel(filters[0]!)).toBe('L-Ultimate · Optolong L-Ultimate, dual-band H-alpha + OIII, 3 nm')
    expect(filterLabel(filters[1]!)).toBe('UV/IR cut')
  })

  it('still works when storage throws', () => {
    const disabled = () => {
      throw new Error('disabled')
    }

    vi.stubGlobal('localStorage', { getItem: disabled, setItem: disabled, removeItem: disabled })

    expect(rememberedFilter('rig-1')).toBeNull()
    expect(() => rememberFilter('rig-1', 'L-Ultimate')).not.toThrow()
  })
})
