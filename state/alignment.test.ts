import { describe, expect, it } from 'vitest'
import { alignment, instruction, noAlignment, trend, type Alignment } from './alignment.ts'
import { entry, fold } from './testing.ts'

const solved = (frame: number, at: number, error?: { altitudeArcmin: number; azimuthArcmin: number; totalArcmin: number }) =>
  entry('vela.align.solve', at, { run: 'a1', frame, file: `polar-align_light_${frame}.fits`, solved: true, raDegrees: 1, decDegrees: 80, at, ...error })

const reduce = (entries: Parameters<typeof fold>[2]) => fold<Alignment>(alignment, noAlignment, entries)

describe('alignment', () => {
  it('starts over with each alignment and keeps the error of every frame from the third on', () => {
    const state = reduce([
      entry('vela.align.started', 10, { run: 'a1', declinationDegrees: 80, hourAnglesDegrees: [-130, -73, -16] }),
      solved(1, 20),
      solved(2, 30),
      solved(3, 40, { altitudeArcmin: 8.4, azimuthArcmin: -12.1, totalArcmin: 14.7 }),
      entry('vela.align.solve', 50, { run: 'a1', frame: 4, file: 'x', solved: false, reason: 'no stars' }),
    ])

    expect(state).toEqual({ run: 'a1', lastFrame: 4, lastFrameAt: 50, errors: [{ frame: 3, at: 40, altitudeArcmin: 8.4, azimuthArcmin: -12.1, totalArcmin: 14.7 }] })
  })

  it('leaves out solves of another alignment', () => {
    const state = reduce([entry('vela.align.started', 10, { run: 'a2' }), solved(3, 40, { altitudeArcmin: 1, azimuthArcmin: 1, totalArcmin: 1.4 })])

    expect(state.errors).toEqual([])
  })
})

describe('instruction', () => {
  const error = (altitudeArcmin: number, azimuthArcmin: number, totalArcmin: number) => ({ frame: 5, at: 1, altitudeArcmin, azimuthArcmin, totalArcmin })

  it('is measuring until the third frame, good under the threshold, and otherwise turns the larger error first', () => {
    expect(instruction(undefined, 1)).toBe('measuring')
    expect(instruction(error(0.5, 0.6, 0.8), 1)).toBe('good')
    expect(instruction(error(8.4, -2, 8.6), 1)).toBe('lower')
    expect(instruction(error(-8.4, 2, 8.6), 1)).toBe('raise')
    expect(instruction(error(2, 12.1, 12.3), 1)).toBe('turnWest')
    expect(instruction(error(2, -12.1, 12.3), 1)).toBe('turnEast')
  })

  it('says whether the total fell or rose since the frame before', () => {
    expect(trend([error(1, 1, 5), error(1, 1, 3)])).toBe('falling')
    expect(trend([error(1, 1, 3), error(1, 1, 5)])).toBe('rising')
    expect(trend([error(1, 1, 3)])).toBeUndefined()
  })
})
