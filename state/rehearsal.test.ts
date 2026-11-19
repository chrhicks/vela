import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import { isRehearsing } from './rehearsal.ts'
import { advance, emptyRig } from './rig.ts'
import { entry, velaStarted } from './testing.ts'

const started = (at: number, rehearsal = 'r1', total = 6) => entry('vela.sweep.started', at, { rehearsal, total })

const moved = (at: number, move: number, overrides: Readonly<Record<string, unknown>> = {}) =>
  entry('vela.sweep.move', at, {
    rehearsal: 'r1',
    move,
    total: 6,
    column: 0,
    altitudeDegrees: 2,
    azimuthDegrees: 180,
    hourAngleDegrees: 0,
    declinationDegrees: -54.55,
    predictedPierSide: 'PIER_WEST',
    flipExpected: false,
    outcome: 'arrived',
    EQUATORIAL_EOD_COORD: { RA: 5, DEC: -54.5 },
    TELESCOPE_PIER_SIDE: 'PIER_WEST',
    ...overrides,
  })

const movedUnreported = (at: number, move: number) => {
  const { body } = moved(at, move)
  const { TELESCOPE_PIER_SIDE: _side, ...rest } = body as Record<string, unknown>

  return entry('vela.sweep.move', at, rest)
}

const ended = (at: number, ending: string, rehearsal = 'r1') => entry('vela.sweep.ended', at, { rehearsal, total: 6, ending })

const reduce = (entries: ReadonlyArray<ReturnType<typeof entry>>) => entries.reduce((state, next) => Result.getOrThrow(advance(state, next)), emptyRig).rehearsal

describe('the sweep rehearsal', () => {
  it('is nothing until one starts, and then going with no move yet', () => {
    expect(reduce([])).toBeUndefined()

    const state = reduce([started(100)])

    expect(state).toMatchObject({ rehearsal: 'r1', total: 6, startedAt: 100, updatedAt: 100, moved: 0, alerts: 0, refused: 0, flipped: false })
    expect(isRehearsing(state)).toBe(true)
  })

  it('keeps the latest move as the current one and counts the moves and alerts so far', () => {
    const state = reduce([started(100), moved(110, 1), moved(120, 2, { outcome: 'alert', reason: 'the mount answered with an alert' }), moved(130, 3, { outcome: 'refused', reason: 'no ON_COORD_SET' }), moved(140, 4, { azimuthDegrees: 150 })])

    expect(state).toMatchObject({ moved: 4, alerts: 1, refused: 1, updatedAt: 140, last: { move: 4, azimuthDegrees: 150 } })
    expect(isRehearsing(state)).toBe(true)
  })

  it('says a flip happened when the reported pier side changes from the move before, and not on the move after', () => {
    const flipped = reduce([started(100), moved(110, 1), moved(120, 2, { TELESCOPE_PIER_SIDE: 'PIER_EAST', flipExpected: true })])
    const after = reduce([started(100), moved(110, 1), moved(120, 2, { TELESCOPE_PIER_SIDE: 'PIER_EAST' }), moved(130, 3, { TELESCOPE_PIER_SIDE: 'PIER_EAST' })])

    expect(flipped).toMatchObject({ flipped: true, side: 'PIER_EAST' })
    expect(after).toMatchObject({ flipped: false, side: 'PIER_EAST' })
  })

  it('does not say a flip when a move reports no pier side, and keeps the last side it knew', () => {
    const state = reduce([started(100), moved(110, 1), movedUnreported(120, 2)])

    expect(state).toMatchObject({ flipped: false, side: 'PIER_WEST' })
  })

  it('ends with how it ended, and is over', () => {
    for (const ending of ['finished', 'stopped', 'pressed'])
      expect(reduce([started(100), moved(110, 1), ended(200, ending)])).toMatchObject({ ending, endedAt: 200, updatedAt: 200, moved: 1 })

    expect(isRehearsing(reduce([started(100), ended(200, 'stopped')]))).toBe(false)
  })

  it('ignores the moves and the end of another rehearsal', () => {
    const state = reduce([started(100, 'r2'), moved(110, 1), ended(120, 'finished')])

    expect(state).toMatchObject({ rehearsal: 'r2', moved: 0 })
    expect(isRehearsing(state)).toBe(true)
  })

  it('starts over with a new rehearsal', () => {
    const state = reduce([started(100), moved(110, 1), ended(120, 'stopped'), started(900, 'r2', 9)])

    expect(state).toMatchObject({ rehearsal: 'r2', total: 9, moved: 0, startedAt: 900 })
    expect(state?.ending).toBeUndefined()
  })

  it('is ended as restarted when Vela starts while it is going, and a finished one stays as it ended', () => {
    expect(reduce([started(100), moved(110, 1), velaStarted(500)])).toMatchObject({ ending: 'restarted', endedAt: 500, moved: 1 })
    expect(reduce([started(100), ended(200, 'finished'), velaStarted(500)])).toMatchObject({ ending: 'finished', endedAt: 200 })
    expect(reduce([velaStarted(500)])).toBeUndefined()
  })
})
