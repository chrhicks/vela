import { describe, expect, it } from 'vitest'
import { calibration, type CalibrationSet } from './calibration.ts'
import { entry, fold, runStarted } from './testing.ts'

const reduce = (entries: Parameters<typeof fold>[2]) => fold<CalibrationSet | undefined>(calibration, undefined, entries)

const started = (run: string, at: number, frameType: string, object = 'calibration') => entry('vela.run.started', at, { run, object, frameType, exposureSeconds: 60, count: 30 })

describe('calibration', () => {
  it('keeps the last set of darks, flats or bias and counts its frames', () => {
    const state = reduce([started('d1', 100, 'dark'), entry('vela.run.exposed', 200, { run: 'd1', frame: 1 }), entry('vela.run.exposed', 300, { run: 'd1', frame: 2 }), runStarted('r1', 400)])

    expect(state).toEqual({ run: 'd1', frameType: 'dark', exposureSeconds: 60, frames: 2, startedAt: 100 })
  })

  it("leaves out light runs and Vela's own operations", () => {
    expect(reduce([runStarted('r1', 100), started('a1', 200, 'dark', 'polar-align')])).toBeUndefined()
  })
})
