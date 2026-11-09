import { describe, expect, it } from 'vitest'
import { readAnalysis, readSolution } from './astap.ts'

describe('reading ASTAP', () => {
  it('reads the median star size and count from an analysis', () => {
    expect(readAnalysis('HFD_MEDIAN=2.4\nSTARS=281\n')).toEqual({ hfd: 2.4, stars: 281 })
  })

  it('reads an analysis that found no stars', () => {
    expect(readAnalysis('HFD_MEDIAN=21.5\nSTARS=0\n')).toEqual({ hfd: 21.5, stars: 0 })
  })

  it('reads nothing from output that is not an analysis', () => {
    expect(readAnalysis('Error opening file')).toBeUndefined()
  })

  it('reads the centre of a solved frame', () => {
    const ini = 'PLTSOLVD=T\nCRVAL1= 1.0125808136511128E+002\nCRVAL2= 8.1246586322836720E+001\nWARNING=Warning scale was inaccurate! Set FOV=2.23d, scale=1.9", FL=403mm\n'

    expect(readSolution(ini)).toEqual({ ok: true, raDegrees: 101.25808136511128, decDegrees: 81.24658632283672 })
  })

  it('gives the reason a frame did not solve', () => {
    expect(readSolution('PLTSOLVD=F\nERROR=No solution found!\n')).toEqual({ ok: false, reason: 'No solution found!' })
  })
})
