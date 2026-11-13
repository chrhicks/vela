import { describe, expect, it } from 'vitest'
import { autofocus, checkOf, noAutofocus, sweepOf, type Autofocus } from './autofocus.ts'
import { entry, fold } from './testing.ts'

const reduce = (entries: Parameters<typeof fold>[2]) => fold<Autofocus>(autofocus, noAutofocus, entries)

const sample = (frame: number, position: number, hfd: number | null, stars: number, run = 'f1') => entry('vela.focus.sample', 100 + frame, { run, frame, position, hfd, stars })

describe('autofocus', () => {
  const state = reduce([
    entry('vela.focus.started', 100, { run: 'f1', positions: [32610, 32560, 32510], step: 50, exposureSeconds: 2 }),
    sample(1, 32610, 4.1, 300),
    sample(2, 32560, 2.9, 650),
    sample(3, 32510, null, 0),
    sample(2, 32560, 9.9, 1, 'other'),
    entry('vela.focus.best', 110, { run: 'f1', position: 32552, how: 'fit' }),
    sample(4, 32552, 2.8, 693),
  ])

  it("keeps the sweep's positions and samples, the best position, and the check at best", () => {
    expect(state.positions).toEqual([32610, 32560, 32510])
    expect(sweepOf(state).map(point => point.position)).toEqual([32610, 32560, 32510])
    expect(state.best).toBe(32552)
    expect(checkOf(state)).toEqual({ frame: 4, position: 32552, hfd: 2.8, stars: 693 })
  })

  it('starts over with the next sweep', () => {
    expect(fold(autofocus, state, [entry('vela.focus.started', 200, { run: 'f2', positions: [1, 2, 3], step: 50, exposureSeconds: 10 })])).toEqual({ run: 'f2', positions: [1, 2, 3], samples: [] })
  })
})
