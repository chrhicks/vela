import { describe, expect, it } from 'vitest'
import { cutShort, isRunning, noOperations, operations, type Operations } from './operations.ts'
import { entry, fold } from './testing.ts'

const reduce = (entries: Parameters<typeof fold>[2]) => fold<Operations>(operations, noOperations, entries)

describe('operations', () => {
  it('runs from its start message until its capture run ends', () => {
    const running = reduce([entry('vela.align.started', 100, { run: 'a1', declinationDegrees: 80, hourAnglesDegrees: [-130, -73, -16] })])

    expect(isRunning(running.align)).toBe(true)
    expect(isRunning(fold(operations, running, [entry('vela.run.ended', 200, { run: 'a1', reason: 'stopped' })]).align)).toBe(false)
    expect(fold(operations, running, [entry('vela.run.ended', 200, { run: 'other', reason: 'done' })])).toBe(running)
  })

  it('keeps autofocus and the filter answer', () => {
    const state = reduce([entry('vela.filter', 50, { filter: 'in' }), entry('vela.focus.started', 60, { run: 'f1', positions: [1, 2, 3], step: 50, exposureSeconds: 10 })])

    expect(state).toMatchObject({ filter: 'in', focus: { run: 'f1', status: 'running' } })
  })

  it('keeps why an operation ended, and calls it cut short unless it was done or stopped', () => {
    const started = reduce([entry('vela.align.started', 100, { run: 'a1', declinationDegrees: 80, hourAnglesDegrees: [-130, -73, -16] })])
    const refused = fold(operations, started, [entry('vela.run.ended', 120, { run: 'a1', reason: 'refused', detail: 'frame 1 did not solve: Not enough stars.', counted: 1 })])

    expect(refused.align).toEqual({ status: 'ended', run: 'a1', startedAt: 100, endedAt: 120, ending: 'refused', detail: 'frame 1 did not solve: Not enough stars.' })
    expect(cutShort(refused.align)).toBe(refused.align)
    expect(cutShort(fold(operations, started, [entry('vela.run.ended', 120, { run: 'a1', reason: 'stopped', detail: 'Stop pressed' })]).align)).toBeUndefined()
    expect(cutShort(fold(operations, started, [entry('vela.run.ended', 120, { run: 'a1', reason: 'done' })]).align)).toBeUndefined()
    expect(cutShort(started.align)).toBeUndefined()
  })
})
