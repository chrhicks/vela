import { describe, expect, it } from 'vitest'
import { isRunning } from './operations.ts'
import { emptyRig, advance } from './rig.ts'
import { isStarting } from './starting.ts'
import { entry, foldRig, velaStarted } from './testing.ts'
import { Result } from 'effect'

const target = { id: 'stellarium-6839', name: 'NGC 7635', raDegrees: 350.2, decDegrees: 61.2 }
const step = (at: number, start: string, name: string, outcome: string, more: object = {}) => entry('vela.target.step', at, { start, target, step: name, outcome, ...more })

const reduce = (entries: ReadonlyArray<ReturnType<typeof entry>>) => entries.reduce((state, next) => Result.getOrThrow(advance(state, next)), emptyRig).starting

describe('starting a target', () => {
  it('keeps the latest report of each step, in the order the steps began', () => {
    const state = reduce([step(100, 's1', 'home', 'started'), step(109, 's1', 'home', 'done'), step(110, 's1', 'stop-guiding', 'started')])

    expect(state).toMatchObject({ start: 's1', target, startedAt: 100, steps: [{ step: 'home', outcome: 'done', since: 100, at: 109 }, { step: 'stop-guiding', outcome: 'started', since: 110, at: 110 }] })
    expect(isStarting(state)).toBe(true)
  })

  it('keeps why a step failed and is over when no step is under way', () => {
    const state = reduce([step(100, 's1', 'guiding', 'started'), step(700, 's1', 'guiding', 'failed', { refusal: { code: 'guider-silent', seconds: 600 } })])

    expect(state?.steps).toEqual([{ step: 'guiding', outcome: 'failed', since: 100, at: 700, refusal: { code: 'guider-silent', seconds: 600 } }])
    expect(isStarting(state)).toBe(false)
  })

  it('starts over with a new start', () => {
    const state = reduce([step(100, 's1', 'home', 'done'), step(900, 's2', 'home', 'started')])

    expect(state).toMatchObject({ start: 's2', startedAt: 900, steps: [{ step: 'home', outcome: 'started' }] })
  })

  it('stops the steps a start left under way when Vela starts again, so the start is over', () => {
    const state = reduce([step(100, 's1', 'centre', 'started'), step(200, 's1', 'centre', 'done'), step(201, 's1', 'autofocus', 'started'), velaStarted(300)])

    expect(state?.steps).toEqual([
      { step: 'centre', outcome: 'done', since: 100, at: 200 },
      { step: 'autofocus', outcome: 'stopped', since: 201, at: 300 },
    ])
    expect(isStarting(state)).toBe(false)
  })

  it('leaves a start that was over, and no start at all, as they were', () => {
    const over = [step(100, 's1', 'home', 'done')]

    expect(reduce([...over, velaStarted(300)])).toEqual(reduce(over))
    expect(reduce([velaStarted(300)])).toBeUndefined()
  })

  it('stops a start in the folded rig state, which is what the run page reads', () => {
    const rig = foldRig([step(100, 's1', 'autofocus', 'started'), entry('vela.focus.started', 101, { run: 'f1', positions: [1, 2] }), entry('vela.run.started', 102, { run: 'f1', object: 'autofocus', frameType: 'light', exposureSeconds: 10 })])

    expect(isStarting(rig.starting)).toBe(true)
    expect(isRunning(rig.operations.focus)).toBe(true)

    const restarted = foldRig([velaStarted(200)], rig)

    expect(isStarting(restarted.starting)).toBe(false)
    expect(isRunning(restarted.operations.focus)).toBe(false)
    expect(restarted.operations.focus).toMatchObject({ status: 'ended', ending: 'interrupted' })
  })
})
