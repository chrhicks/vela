import { describe, expect, it } from 'vitest'
import { emptyRig, advance } from './rig.ts'
import { isStarting } from './starting.ts'
import { entry } from './testing.ts'
import { Result } from 'effect'

const target = { id: 'stellarium-6839', name: 'NGC 7635', raDegrees: 350.2, decDegrees: 61.2 }
const step = (at: number, start: string, name: string, outcome: string, more: object = {}) => entry('vela.target.step', at, { start, target, step: name, outcome, ...more })

const reduce = (entries: ReadonlyArray<ReturnType<typeof entry>>) => entries.reduce((state, next) => Result.getOrThrow(advance(state, next)), emptyRig).starting

describe('starting a target', () => {
  it('keeps the latest report of each step, in the order the steps began', () => {
    const state = reduce([step(100, 's1', 'home', 'started'), step(109, 's1', 'home', 'done'), step(110, 's1', 'stop-guiding', 'started')])

    expect(state).toMatchObject({ start: 's1', target, startedAt: 100, steps: [{ step: 'home', outcome: 'done', at: 109 }, { step: 'stop-guiding', outcome: 'started', at: 110 }] })
    expect(isStarting(state)).toBe(true)
  })

  it('keeps why a step failed and is over when no step is under way', () => {
    const state = reduce([step(100, 's1', 'guiding', 'started'), step(700, 's1', 'guiding', 'failed', { refusal: { code: 'guider-silent', seconds: 600 } })])

    expect(state?.steps).toEqual([{ step: 'guiding', outcome: 'failed', at: 700, refusal: { code: 'guider-silent', seconds: 600 } }])
    expect(isStarting(state)).toBe(false)
  })

  it('starts over with a new start', () => {
    const state = reduce([step(100, 's1', 'home', 'done'), step(900, 's2', 'home', 'started')])

    expect(state).toMatchObject({ start: 's2', startedAt: 900, steps: [{ step: 'home', outcome: 'started' }] })
  })
})
