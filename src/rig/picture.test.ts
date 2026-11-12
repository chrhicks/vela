import { StreamPosition } from '../../state/entry.ts'
import { describe, expect, it } from 'vitest'
import { connected, indiserver, phd2, phd2Link, startedAt, wire } from '../testing/entries.ts'
import { makePicture } from './picture.ts'

const t = (seconds: number) => startedAt + seconds * 1000

describe('picture', () => {
  it('holds definition facts, state, values and when they last changed', () => {
    const picture = makePicture()

    picture.apply(connected(t(0)), 0)
    picture.apply(wire(t(1), 'def', 'focuser', 'ABS_FOCUS_POSITION', { FOCUS_ABSOLUTE_POSITION: 1200 }, 'Ok'), 0)
    picture.apply(wire(t(5), 'set', 'focuser', 'ABS_FOCUS_POSITION', { FOCUS_ABSOLUTE_POSITION: 1200 }, 'Ok'), 0)

    expect(picture.property('focuser', 'ABS_FOCUS_POSITION')).toEqual({ state: 'Ok', values: { FOCUS_ABSOLUTE_POSITION: 1200 }, limits: {}, changedAt: t(1), confirmedAt: t(5) })

    picture.apply(wire(t(9), 'set', 'focuser', 'ABS_FOCUS_POSITION', { FOCUS_ABSOLUTE_POSITION: 1500 }, 'Busy'), 0)

    expect(picture.property('focuser', 'ABS_FOCUS_POSITION')).toEqual({ state: 'Busy', values: { FOCUS_ABSOLUTE_POSITION: 1500 }, limits: {}, changedAt: t(9), confirmedAt: t(9) })
  })

  it('merges a partial update into the last values and keeps the state when the update has none', () => {
    const picture = makePicture()

    picture.apply(wire(t(1), 'def', 'mount', 'EQUATORIAL_EOD_COORD', { RA: 5.5, DEC: 20 }, 'Ok'), 0)
    picture.apply(wire(t(2), 'set', 'mount', 'EQUATORIAL_EOD_COORD', { RA: 5.6 }), 0)

    expect(picture.property('mount', 'EQUATORIAL_EOD_COORD')?.values).toEqual({ RA: 5.6, DEC: 20 })
    expect(picture.property('mount', 'EQUATORIAL_EOD_COORD')?.state).toBe('Ok')
  })

  it('drops a deleted property, and every property of a deleted device', () => {
    const picture = makePicture()

    picture.apply(wire(t(1), 'def', 'box', 'POWER_SENSORS', { SENSOR_VOLTAGE: 12.9 }, 'Ok'), 0)
    picture.apply(wire(t(1), 'def', 'box', 'DEW_DUTY_CYCLES', { DEW_CHANNEL_1: 0 }, 'Ok'), 0)
    picture.apply(wire(t(2), 'del', 'box', 'DEW_DUTY_CYCLES', {}), 0)

    expect(picture.property('box', 'DEW_DUTY_CYCLES')).toBeUndefined()
    expect(picture.property('box', 'POWER_SENSORS')).toBeDefined()

    picture.apply(wire(t(3), 'del', 'box', undefined, {}), 0)

    expect(picture.property('box', 'POWER_SENSORS')).toBeUndefined()
  })

  it('forgets everything at the next rig connection', () => {
    const picture = makePicture()

    picture.apply(connected(t(0), 1, 'run-a'), 0)
    picture.apply(wire(t(1), 'def', 'mount', 'TELESCOPE_PARK', { PARK: true }, 'Ok'), 0)
    picture.apply(connected(t(10), 2, 'run-b'), 0)

    expect(picture.property('mount', 'TELESCOPE_PARK')).toBeUndefined()
    expect(picture.rig()).toMatchObject({ at: t(10), run: 'run-b', connection: 2 })
  })

  it('forgets the devices when the rig loses indiserver', () => {
    const picture = makePicture()

    picture.apply(connected(t(0)), 0)
    picture.apply(indiserver(t(1), 'connected'), 0)
    picture.apply(wire(t(2), 'def', 'mount', 'TELESCOPE_PARK', { PARK: true }, 'Ok'), 0)
    picture.apply(indiserver(t(3), 'closed'), 0)

    expect(picture.indi()).toBe('closed')
    expect(picture.property('mount', 'TELESCOPE_PARK')).toBeUndefined()
  })

  it('keeps the last value the rig wrote to a property, apart from what the driver reports', () => {
    const picture = makePicture()

    picture.apply(wire(t(1), 'def', 'primary', 'CCD_TEMPERATURE', { CCD_TEMPERATURE_VALUE: 20 }, 'Ok'), 0)
    picture.apply(wire(t(2), 'new', 'primary', 'CCD_TEMPERATURE', { CCD_TEMPERATURE_VALUE: -10 }), 0)

    expect(picture.written('primary', 'CCD_TEMPERATURE')).toEqual({ values: { CCD_TEMPERATURE_VALUE: -10 }, at: t(2) })
    expect(picture.property('primary', 'CCD_TEMPERATURE')?.values).toEqual({ CCD_TEMPERATURE_VALUE: 20 })
  })

  it('follows PHD2 from its events and forgets the state when PHD2 goes away', () => {
    const picture = makePicture()

    picture.apply(phd2Link(t(1), 'connected'), 0)
    picture.apply(phd2(t(2), { Event: 'AppState', State: 'Stopped' }), 0)
    picture.apply(phd2(t(3), { Event: 'StartGuiding' }), 0)

    expect(picture.phd2()).toEqual({ link: 'connected', state: 'Guiding', changedAt: t(3), lastStepAt: undefined })

    picture.apply(phd2(t(4), { Event: 'GuideStep', Frame: 4 }), 0)

    expect(picture.phd2()).toMatchObject({ changedAt: t(3), lastStepAt: t(4) })

    picture.apply(phd2(t(5), { Event: 'GuidingDithered' }), 0)

    expect(picture.phd2().lastStepAt).toBe(t(4))

    picture.apply(phd2Link(t(6), 'closed'), 0)

    expect(picture.phd2()).toEqual({ link: 'closed', state: undefined, changedAt: t(6), lastStepAt: undefined })
  })

  it('keeps the number limits of a definition through later updates, and drops them with the property', () => {
    const picture = makePicture()

    picture.apply(wire(t(1), 'def', 'focuser', 'ABS_FOCUS_POSITION', { FOCUS_ABSOLUTE_POSITION: 100 }, 'Ok', 'in', { FOCUS_ABSOLUTE_POSITION: { min: 0, max: 60000 } }), 0)
    picture.apply(wire(t(2), 'set', 'focuser', 'ABS_FOCUS_POSITION', { FOCUS_ABSOLUTE_POSITION: 200 }, 'Busy'), 0)

    expect(picture.property('focuser', 'ABS_FOCUS_POSITION')?.limits).toEqual({ FOCUS_ABSOLUTE_POSITION: { min: 0, max: 60000 } })

    picture.apply(wire(t(3), 'def', 'focuser', 'ABS_FOCUS_POSITION', { FOCUS_ABSOLUTE_POSITION: 200 }, 'Ok'), 0)

    expect(picture.property('focuser', 'ABS_FOCUS_POSITION')?.limits).toEqual({})
  })

  it('notes when the rig was last heard from', () => {
    const picture = makePicture()

    picture.apply(wire(t(1), 'def', 'mount', 'TELESCOPE_PARK', { PARK: true }, 'Ok'), 111)
    picture.apply({ seq: StreamPosition.make(0), kind: 'system', at: 1, body: {} }, 222)

    expect(picture.heardAt()).toBe(111)
  })
})
