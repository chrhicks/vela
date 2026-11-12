import { Option } from 'effect'
import { describe, expect, it } from 'vitest'
import { run, type Run } from './run.ts'
import { entry, fold, read, runStarted } from './testing.ts'

const reduce = (entries: Parameters<typeof fold>[2]) => fold<Run | undefined>(run, undefined, entries)

describe('run', () => {
  it('starts a run with what was asked for', () => {
    expect(reduce([runStarted('r1', 1000)])).toEqual({ status: 'capturing', id: 'r1', object: 'M 31', frameType: 'light', exposureSeconds: 120, count: 30, startedAt: 1000, frames: 0, failures: 0 })
  })

  it('counts frames and failures, then ends with its reason as a code', () => {
    const state = reduce([
      runStarted('r1', 1000),
      entry('vela.run.exposed', 1130, { run: 'r1', frame: 1, sequence: 1, file: 'm31_001.fits' }),
      entry('vela.run.failed', 1260, { run: 'r1', attempt: 2, why: 'the camera reported an alert' }),
      entry('vela.run.exposed', 1390, { run: 'r1', frame: 2, sequence: 2, file: 'm31_002.fits' }),
      entry('vela.run.ended', 1400, { run: 'r1', reason: 'stopped', detail: 'Stop pressed', counted: 2 }),
    ])

    expect(state).toMatchObject({ status: 'ended', frames: 2, failures: 1, endedAt: 1400, reason: 'stopped' })
  })

  it('ignores entries of another run', () => {
    const state = reduce([runStarted('r2', 1000), entry('vela.run.exposed', 1130, { run: 'r1', frame: 7 }), entry('vela.run.ended', 1200, { run: 'r1', reason: 'done' })])

    expect(state).toMatchObject({ status: 'capturing', id: 'r2', frames: 0 })
  })

  it('starts an open-ended run, such as alignment, with no count', () => {
    const state = reduce([entry('vela.run.started', 1000, { run: 'a1', object: 'polar-align', frameType: 'light', exposureSeconds: 2, gain: 100, offset: 50, cooler: 'keep', sequence: 'polar-align_light' })])

    expect(state).toMatchObject({ status: 'capturing', id: 'a1', object: 'polar-align', count: undefined })
  })

  it('replaces an ended run when the next one starts', () => {
    const state = reduce([runStarted('r1', 1000), entry('vela.run.ended', 1100, { run: 'r1', reason: 'done' }), runStarted('r2', 2000, 'M 42')])

    expect(state).toMatchObject({ status: 'capturing', id: 'r2', object: 'M 42' })
  })

  it('returns the same object for an entry that does not concern it', () => {
    const state = reduce([runStarted('r1', 1000)])
    const measured = Option.getOrThrow(read(entry('vela.frame.stats', 1001, { night: '2026-11-08', file: 'a.fits', stars: 1, hfdPixels: 2, elongation: 1, sky: 3, noise: 4 })))

    expect(run(state, measured)).toBe(state)
  })
})
