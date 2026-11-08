import { describe, expect, it } from 'vitest'
import { catalogRows } from './data.ts'

describe('catalog data', () => {
  it('has unique ids and J2000 positions inside their ranges', () => {
    expect(new Set(catalogRows.map(row => row[0])).size).toBe(catalogRows.length)

    for (const [id, , , , raDegrees, decDegrees] of catalogRows) {
      expect(raDegrees, id).toBeGreaterThanOrEqual(0)
      expect(raDegrees, id).toBeLessThan(360)
      expect(Math.abs(decDegrees), id).toBeLessThanOrEqual(90)
    }
  })

  it('lists every row under its own name among its aliases', () => {
    for (const [id, catalogName, , aliases] of catalogRows) {
      expect(aliases, id).toContain(catalogName)
    }
  })

  it('keeps the familiar targets at their J2000 positions', () => {
    const m31 = catalogRows.find(row => row[0] === 'ngc0224')

    expect(m31?.[2]).toBe('Andromeda Galaxy')
    expect(m31?.[4]).toBeCloseTo(10.68, 1)
    expect(m31?.[5]).toBeCloseTo(41.27, 1)
  })
})
