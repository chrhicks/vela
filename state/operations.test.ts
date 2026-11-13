import { describe, expect, it } from 'vitest'
import { isRunning, noOperations, operations, type Operations } from './operations.ts'
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
})
