import { describe, expect, it } from 'vitest'
import { frames, type Frame } from './frames.ts'
import { entry, frameKept, frameMeasured } from './testing.ts'

const reduce = (entries: ReadonlyArray<ReturnType<typeof entry>>) => entries.reduce<ReadonlyArray<Frame>>(frames, [])

describe('frames', () => {
  it('adds a kept frame, then its measurements', () => {
    const state = reduce([frameKept('m31_042.fits', 1000), frameMeasured('m31_042.fits', 1002, { stars: 846, hfdPixels: 2.9 })])

    expect(state).toEqual([{ night: '2026-11-08', file: 'm31_042.fits', keptAt: 1000, measurements: { stars: 846, hfdPixels: 2.9, elongation: 1.06, sky: 1200, noise: 30 } }])
  })

  it('keeps a frame with no stars found as measured', () => {
    const state = reduce([frameKept('m31_043.fits', 1000), frameMeasured('m31_043.fits', 1002, { stars: null, hfdPixels: null, elongation: null })])

    expect(state[0]?.measurements).toMatchObject({ stars: null, hfdPixels: null, elongation: null })
  })

  it('tells frames of the same name on different nights apart', () => {
    const state = reduce([frameKept('m31_001.fits', 1000, '2026-11-08'), frameKept('m31_001.fits', 9000, '2026-11-09'), frameMeasured('m31_001.fits', 9002, {}, '2026-11-09')])

    expect(state.map(frame => frame.measurements === undefined)).toEqual([true, false])
  })

  it('keeps one row when a frame is announced twice', () => {
    expect(reduce([frameKept('m31_042.fits', 1000), frameKept('m31_042.fits', 1001)])).toHaveLength(1)
  })

  it('returns the same list for measurements of a frame it does not hold, and for other entries', () => {
    const state = reduce([frameKept('m31_042.fits', 1000)])

    expect(frames(state, frameMeasured('m31_099.fits', 1002, {}))).toBe(state)
    expect(frames(state, entry('phd2.GuideStep', 1003, {}))).toBe(state)
  })
})
