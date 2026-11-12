import { describe, expect, it } from 'vitest'
import { dewHeaters, focusPosition, mountActivity, readings, sensorCelsius, type Readings } from './readings.ts'
import { entry, fold } from './testing.ts'

const reported = (device: string, property: string | undefined, elements: Readonly<Record<string, number | boolean | string>>, state = 'Ok', type = 'set', at = 1) =>
  entry('wire', at, { dir: 'in', device, type, ...(property === undefined ? {} : { property }), state, elements })

const reduce = (entries: Parameters<typeof fold>[2]) => fold<Readings>(readings, {}, entries)

describe('readings', () => {
  it('keeps the latest value of each property, merging a report that carries only some elements', () => {
    const state = reduce([reported('mount', 'EQUATORIAL_EOD_COORD', { RA: 1, DEC: 2 }, 'Ok', 'def', 1), reported('mount', 'EQUATORIAL_EOD_COORD', { RA: 1.5 }, 'Busy', 'set', 2)])

    expect(state['mount']?.['EQUATORIAL_EOD_COORD']).toEqual({ state: 'Busy', values: { RA: 1.5, DEC: 2 }, at: 2 })
  })

  it('returns the same object when a report changes nothing', () => {
    const state = reduce([reported('focuser', 'ABS_FOCUS_POSITION', { FOCUS_ABSOLUTE_POSITION: 32562 }, 'Ok', 'set', 1)])

    expect(fold(readings, state, [reported('focuser', 'ABS_FOCUS_POSITION', { FOCUS_ABSOLUTE_POSITION: 32562 }, 'Ok', 'set', 9)])).toBe(state)
  })

  it('forgets a deleted property, a deleted device, and everything when the rig reconnects or loses its device server', () => {
    const state = reduce([reported('mount', 'TELESCOPE_PARK', { PARK: true }), reported('mount', 'TELESCOPE_TRACK_STATE', { TRACK_ON: false }), reported('box', 'DEW_DUTY_CYCLES', { DEW_CHANNEL_1: 10 })])

    expect(Object.keys(fold(readings, state, [reported('mount', 'TELESCOPE_PARK', {}, 'Idle', 'del')])['mount'] ?? {})).toEqual(['TELESCOPE_TRACK_STATE'])
    expect(Object.keys(fold(readings, state, [reported('box', undefined, {}, 'Idle', 'del')]))).toEqual(['mount'])
    expect(fold(readings, state, [entry('client.connected', 5, { run: 'r2' })])).toEqual({})
    expect(fold(readings, state, [entry('client.connection', 5, { target: 'indiserver', status: 'closed' })])).toEqual({})
    expect(fold(readings, state, [entry('client.connection', 5, { target: 'phd2', status: 'closed' })])).toBe(state)
  })

  it('leaves the rig program own writes out', () => {
    expect(reduce([entry('wire', 1, { dir: 'out', device: 'focuser', type: 'new', property: 'ABS_FOCUS_POSITION', elements: { FOCUS_ABSOLUTE_POSITION: 1 } })])).toEqual({})
  })
})

describe('the rig line selectors', () => {
  const rig = reduce([
    reported('mount', 'TELESCOPE_PARK', { PARK: false, UNPARK: true }),
    reported('mount', 'TELESCOPE_TRACK_STATE', { TRACK_ON: true, TRACK_OFF: false }),
    reported('mount', 'EQUATORIAL_EOD_COORD', { RA: 2.3, DEC: 45 }, 'Ok'),
    reported('primary', 'CCD_TEMPERATURE', { CCD_TEMPERATURE_VALUE: -10 }),
    reported('focuser', 'ABS_FOCUS_POSITION', { FOCUS_ABSOLUTE_POSITION: 32562 }),
    reported('box', 'DEW_LABELS', { DEW_CHANNEL_1: 'Dew A', DEW_CHANNEL_2: '' }, 'Idle', 'def'),
    reported('box', 'DEW_DUTY_CYCLES', { DEW_CHANNEL_2: 40, DEW_CHANNEL_1: 60 }),
  ])

  it('read the mount, sensor, focuser and dew heaters', () => {
    expect(mountActivity(rig)).toBe('tracking')
    expect(sensorCelsius(rig)).toBe(-10)
    expect(focusPosition(rig)).toBe(32562)
    expect(dewHeaters(rig)).toEqual([{ label: 'Dew A', percent: 60 }, { label: 'DEW_CHANNEL_2', percent: 40 }])
  })

  it('call the mount parked before slewing, slewing before tracking, and say nothing before it has reported', () => {
    expect(mountActivity(fold(readings, rig, [reported('mount', 'EQUATORIAL_EOD_COORD', { RA: 3 }, 'Busy')]))).toBe('slewing')
    expect(mountActivity(fold(readings, rig, [reported('mount', 'TELESCOPE_PARK', { PARK: true, UNPARK: false })]))).toBe('parked')
    expect(mountActivity({})).toBeUndefined()
  })
})
