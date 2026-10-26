import { describe, expect, it } from 'vitest'
import { normalEvidence, starCause, type FrameEvidence } from './cause.js'
import { defaultThresholds } from './thresholds.js'

const t = defaultThresholds

const usual: FrameEvidence = { peaks: 500, blended: 15, sky: 680, axisRatio: 1.2 }

const frames = (count: number, change: Partial<FrameEvidence> = {}): FrameEvidence[] =>
  Array.from({ length: count }, () => ({ ...usual, ...change }))

const normal = normalEvidence(frames(5), t)

describe('normalEvidence', () => {
  it('is the median of the last accepted frames, and nothing until there are enough to trust', () => {
    expect(normalEvidence(frames(2), t)).toBeNull()

    expect(normal).toEqual({ peaks: 500, sky: 680, blendedShare: 15 / 500 })

    const drifted = [...frames(4, { sky: 100 }), ...frames(5)]

    expect(normalEvidence(drifted, t)!.sky).toBe(680)
  })
})

describe('starCause', () => {
  it('names a sky that brightened, even when only one frame of the last three shows it', () => {
    const recent = [usual, { ...usual, sky: 7148, peaks: 56 }, usual]

    expect(starCause(recent, normal, t)).toBe('sky brightened')
  })

  it('names trailed stars from the shape of the strong stars of at least two frames', () => {
    expect(starCause(frames(3, { axisRatio: 2.6 }), normal, t)).toBe('stars trailed')
    expect(starCause([{ ...usual, axisRatio: 2.6 }, { ...usual, axisRatio: 2.8 }, { ...usual, axisRatio: null }], normal, t)).toBe('stars trailed')
  })

  it('does not call stars trailed from one frame, from one trailed frame beside a round one, or from a ratio under the trailing scale', () => {
    expect(starCause([usual, usual, { ...usual, axisRatio: 2.9 }], normal, t)).toBeNull()
    expect(starCause([{ ...usual, axisRatio: 1.2 }, { ...usual, axisRatio: null }, { ...usual, axisRatio: 2.9 }], normal, t)).toBeNull()
    expect(starCause(frames(3, { axisRatio: 1.5 }), normal, t)).toBeNull()
  })

  it('names smeared or soft stars when far more peaks than usual are blended', () => {
    expect(starCause(frames(3, { peaks: 5000, blended: 4800, axisRatio: null }), normal, t)).toBe('stars smeared or soft')
  })

  it('names few peaks when the peaks themselves fell and nothing else explains it', () => {
    expect(starCause(frames(3, { peaks: 150, blended: 4, axisRatio: null }), normal, t)).toBe('few peaks')
  })

  it('names sky before shape before peaks when several hold', () => {
    const everything = { peaks: 100, blended: 90, sky: 7000, axisRatio: 2.5 }

    expect(starCause(frames(3, everything), normal, t)).toBe('sky brightened')
    expect(starCause(frames(3, { ...everything, sky: 680 }), normal, t)).toBe('stars trailed')
    expect(starCause(frames(3, { ...everything, sky: 680, axisRatio: null }), normal, t)).toBe('stars smeared or soft')
  })

  it('names nothing from frames that look like the usual', () => {
    expect(starCause(frames(3), normal, t)).toBeNull()
  })

  it('names nothing it needs a normal for until there is one, and nothing from too few frames', () => {
    expect(starCause(frames(3, { sky: 7000, peaks: 20 }), null, t)).toBeNull()
    expect(starCause([{ ...usual, sky: 7000 }], normal, t)).toBeNull()
    expect(starCause([], normal, t)).toBeNull()
  })

  it('still names trailed stars with no normal, because the shape needs none', () => {
    expect(starCause(frames(3, { axisRatio: 2.6 }), null, t)).toBe('stars trailed')
  })
})
