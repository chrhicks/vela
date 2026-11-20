import { describe, expect, it } from 'vitest'
import { isSweeping } from './sweep.ts'
import { entry, foldRig, velaStarted } from './testing.ts'

const frame = (column: number, stars: number, altitude: number) => ({
  sweep: 'sweep-1',
  column,
  azimuthDegrees: 177.5,
  file: `horizon-sweep_light_00${column + 1}.fits`,
  at: 5,
  commanded: { altitudeDegrees: altitude, azimuthDegrees: 177.5, hourAngleDegrees: -2, declinationDegrees: 20 },
  solve: { solved: false, reason: 'no stars' },
  stars,
  class: 'blocked',
  pointing: { source: 'commanded', altitudeDegrees: altitude, azimuthDegrees: 177.5 },
})

const fold = foldRig

describe('the sweep on the rig state', () => {
  it('follows a sweep from its start to its end, counting frames, edges and alerts', () => {
    const started = fold([entry('vela.sweep.run.started', 1, { sweep: 'sweep-1', exposureSeconds: 2, columns: 72 })])

    expect(started.sweep).toMatchObject({ sweep: 'sweep-1', columns: 72, exposureSeconds: 2, frames: 0, edges: [], alerts: 0 })
    expect(isSweeping(started.sweep)).toBe(true)

    const later = fold([
      entry('vela.sweep.run.started', 1, { sweep: 'sweep-1', exposureSeconds: 2, columns: 72 }),
      entry('vela.sweep.frame', 2, frame(0, 40, 25)),
      entry('vela.sweep.frame', 3, frame(0, 10, 27)),
      entry('vela.sweep.column', 4, { sweep: 'sweep-1', column: 0, azimuthDegrees: 177.5, edgeAltitudeDegrees: 26, how: 'between-frames', frames: 2 }),
      entry('vela.sweep.alert', 5, { sweep: 'sweep-1', column: 1, text: 'the frames record could not be written' }),
    ])

    expect(later.sweep).toMatchObject({ frames: 2, alerts: 1, alert: 'the frames record could not be written', last: { stars: 10 }, updatedAt: 5 })
    expect(later.sweep?.edges).toEqual([{ sweep: 'sweep-1', column: 0, azimuthDegrees: 177.5, edgeAltitudeDegrees: 26, how: 'between-frames', frames: 2 }])
  })

  it('ends with the ending it was given, and ignores entries of another sweep', () => {
    const ended = fold([
      entry('vela.sweep.run.started', 1, { sweep: 'sweep-1', exposureSeconds: 2, columns: 72 }),
      entry('vela.sweep.frame', 2, { ...frame(0, 40, 25), sweep: 'sweep-0' }),
      entry('vela.sweep.run.ended', 3, { sweep: 'sweep-1', columns: 3, ending: 'stopped' }),
    ])

    expect(ended.sweep).toMatchObject({ ending: 'stopped', endedAt: 3, frames: 0 })
    expect(isSweeping(ended.sweep)).toBe(false)
  })

  it('is ended as restarted when Vela starts again under a sweep, and left alone when it had ended', () => {
    const restarted = fold([entry('vela.sweep.run.started', 1, { sweep: 'sweep-1', exposureSeconds: 2, columns: 72 }), velaStarted(9)])
    const done = fold([entry('vela.sweep.run.started', 1, { sweep: 'sweep-1', exposureSeconds: 2, columns: 72 }), entry('vela.sweep.run.ended', 2, { sweep: 'sweep-1', columns: 72, ending: 'finished' }), velaStarted(9)])

    expect(restarted.sweep).toMatchObject({ ending: 'restarted', endedAt: 9 })
    expect(done.sweep?.ending).toBe('finished')
  })
})
