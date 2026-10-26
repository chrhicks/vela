import { describe, expect, it } from 'vitest'
import { compareStatistics } from './compare.ts'
import type { Measurement } from './measure.ts'

function measured(detectedStars: number, medianHfrPixels: number | null): Measurement {
  return { status: 'measured', detectedStars, medianHfrPixels, milliseconds: 1 }
}

describe('compareStatistics', () => {
  it('matches the same count and HFR', () => {
    expect(compareStatistics(measured(259, 1.593), { detectedStars: 259, medianHfrPixels: 1.593 })).toEqual({
      status: 'match',
    })
  })

  it('matches a frame with no stars and no HFR', () => {
    expect(compareStatistics(measured(0, null), { detectedStars: 0, medianHfrPixels: null }).status).toBe('match')
  })

  it('reports a different count', () => {
    expect(compareStatistics(measured(258, 1.593), { detectedStars: 259, medianHfrPixels: 1.593 })).toEqual({
      status: 'differ',
      differences: ['stars 258 vs recorded 259'],
      hfrDifferencePixels: null,
    })
  })

  it('reports an HFR that moved, and by how much', () => {
    const comparison = compareStatistics(measured(259, 1.5), { detectedStars: 259, medianHfrPixels: 1.6 })

    expect(comparison.status).toBe('differ')

    if (comparison.status === 'differ') {
      expect(comparison.hfrDifferencePixels).toBeCloseTo(0.1)
      expect(comparison.differences).toEqual(['HFR 1.5000 vs recorded 1.6000'])
    }
  })

  it('does not call a missing HFR equal to a measured one', () => {
    expect(compareStatistics(measured(0, null), { detectedStars: 0, medianHfrPixels: 1.4 }).status).toBe('differ')
    expect(compareStatistics(measured(3, 1.4), { detectedStars: 3, medianHfrPixels: null }).status).toBe('differ')
  })

  it('never treats a missing record as a match', () => {
    expect(compareStatistics(measured(0, null), null)).toEqual({ status: 'unrecorded' })
  })

  it('never treats a failed measurement as a match', () => {
    const comparison = compareStatistics({ status: 'failed', reason: 'bad header' }, { detectedStars: 0, medianHfrPixels: null })

    expect(comparison).toEqual({ status: 'failed', reason: 'bad header' })
  })
})
