import { describe, expect, it } from 'vitest'
import type { FrameClass } from '../../state/entries.ts'
import { decodeConfig } from '../config.ts'
import { nextInColumn, startAltitude, type ColumnFrame } from './column.ts'
import { SweepSettings } from './settings.ts'

const settings = decodeConfig(SweepSettings, {})

const at = (altitude: number, frameClass: FrameClass, used = altitude): ColumnFrame => ({ commandedAltitudeDegrees: altitude, altitudeDegrees: used, class: frameClass })

describe('where a column starts', () => {
  it('is the first guess for the first column and the previous edge after that', () => {
    expect(startAltitude(undefined, settings)).toBe(25)
    expect(startAltitude(31.5, settings)).toBe(31.5)
  })

  it('is held between the floor and the ceiling', () => {
    expect(startAltitude(-3, settings)).toBe(2)
    expect(startAltitude(88, settings)).toBe(70)
  })
})

describe('following the edge down a column', () => {
  it('goes one step lower after sky and one step higher after blocked', () => {
    expect(nextInColumn([at(25, 'sky')], settings)).toEqual({ step: 'frame', altitudeDegrees: 23 })
    expect(nextInColumn([at(25, 'blocked')], settings)).toEqual({ step: 'frame', altitudeDegrees: 27 })
    expect(nextInColumn([at(25, 'sky'), at(23, 'sky')], settings)).toEqual({ step: 'frame', altitudeDegrees: 21 })
  })

  it('is done between two frames that go from sky to blocked or from blocked to sky, at the midpoint of their altitudes', () => {
    const downward = nextInColumn([at(25, 'sky', 25.2), at(23, 'blocked', 23.4)], settings)
    const upward = nextInColumn([at(25, 'blocked', 24.8), at(27, 'sky', 27)], settings)

    expect(downward).toMatchObject({ step: 'done', how: 'between-frames' })
    expect(upward).toMatchObject({ step: 'done', how: 'between-frames' })
    expect('edgeAltitudeDegrees' in downward && downward.edgeAltitudeDegrees).toBeCloseTo(24.3, 9)
    expect('edgeAltitudeDegrees' in upward && upward.edgeAltitudeDegrees).toBeCloseTo(25.9, 9)
  })

  it('starts the next column at the midpoint of the altitudes the two frames were commanded, whatever the pointing error', () => {
    const downward = nextInColumn([at(25, 'sky', 25.4), at(23, 'blocked', 23.4)], settings)
    const upward = nextInColumn([at(25, 'blocked', 25.4), at(27, 'sky', 27.4)], settings)

    expect('startAltitudeDegrees' in downward && downward.startAltitudeDegrees).toBeCloseTo(24, 9)
    expect('startAltitudeDegrees' in upward && upward.startAltitudeDegrees).toBeCloseTo(26, 9)
    expect('edgeAltitudeDegrees' in downward && downward.edgeAltitudeDegrees).toBeCloseTo(24.4, 9)
  })

  it('does not take two frames of the same class as an edge', () => {
    expect(nextInColumn([at(25, 'blocked'), at(27, 'blocked')], settings)).toEqual({ step: 'frame', altitudeDegrees: 29 })
  })

  it('records a column open to the floor when the frame at the floor is sky', () => {
    expect(nextInColumn([at(5, 'sky'), at(3, 'sky'), at(2, 'sky')], settings)).toEqual({ step: 'done', edgeAltitudeDegrees: 2, startAltitudeDegrees: 2, how: 'open-to-floor' })
  })

  it('steps down to the floor, no lower, when the next step would pass it', () => {
    expect(nextInColumn([at(3, 'sky')], settings)).toEqual({ step: 'frame', altitudeDegrees: 2 })
  })

  it('records a column blocked to the ceiling when the frame at the ceiling is blocked', () => {
    expect(nextInColumn([at(68, 'blocked'), at(70, 'blocked')], settings)).toEqual({ step: 'done', edgeAltitudeDegrees: 70, startAltitudeDegrees: 70, how: 'blocked-to-ceiling' })
    expect(nextInColumn([at(69, 'blocked')], settings)).toEqual({ step: 'frame', altitudeDegrees: 70 })
  })

  it('goes on from a frame blocked at the floor, since the sky may start just above', () => {
    expect(nextInColumn([at(2, 'blocked')], settings)).toEqual({ step: 'frame', altitudeDegrees: 4 })
  })

  it('keeps going on the same side of the edge, however many frames of one class there are', () => {
    expect(nextInColumn([at(25, 'sky'), at(23, 'sky'), at(21, 'sky')], settings)).toEqual({ step: 'frame', altitudeDegrees: 19 })
  })

  it('steps from the commanded altitude, not the one the frame was found at', () => {
    expect(nextInColumn([at(25, 'sky', 25.6)], settings)).toEqual({ step: 'frame', altitudeDegrees: 23 })
  })
})
