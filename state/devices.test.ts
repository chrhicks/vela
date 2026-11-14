import { Result } from 'effect'
import { describe, expect, it } from 'vitest'
import { dewHeaters, focusPosition, mountActivity, noDevices, sensorCelsius } from './devices.ts'
import { advance } from './rig.ts'
import { entry, foldRig } from './testing.ts'

const reported = (device: string, property: string | undefined, elements: Readonly<Record<string, number | boolean | string>>, state = 'Ok', type = 'set', at = 1) =>
  entry('wire', at, { dir: 'in', device, type, ...(property === undefined ? {} : { property }), state, elements })

const rig = foldRig([
  reported('mount', 'TELESCOPE_PARK', { PARK: false, UNPARK: true }),
  reported('mount', 'TELESCOPE_TRACK_STATE', { TRACK_ON: true, TRACK_OFF: false }),
  reported('mount', 'EQUATORIAL_EOD_COORD', { RA: 2.3, DEC: 45 }, 'Ok'),
  reported('primary', 'CCD_TEMPERATURE', { CCD_TEMPERATURE_VALUE: -10 }),
  reported('focuser', 'ABS_FOCUS_POSITION', { FOCUS_ABSOLUTE_POSITION: 32562 }),
  reported('box', 'DEW_LABELS', { DEW_CHANNEL_1: 'Dew A', DEW_CHANNEL_2: '' }, 'Idle', 'def'),
  reported('box', 'AUTO_DEW_CONTROL', { DEW_CHANNEL_1: true }, 'Idle', 'def'),
  reported('box', 'DEW_DUTY_CYCLES', { DEW_CHANNEL_2: 40, DEW_CHANNEL_1: 60 }),
])

describe('devices', () => {
  it('holds each reported property with its values typed', () => {
    expect(rig.devices.mount.EQUATORIAL_EOD_COORD).toEqual({ state: 'Ok', values: { RA: 2.3, DEC: 45 }, at: 1 })
    expect(rig.devices.focuser.ABS_FOCUS_POSITION?.values.FOCUS_ABSOLUTE_POSITION).toBe(32562)
  })

  it('fails the entry when a reading does not have the shape the schema names, and keeps the state before it', () => {
    const wrongType = advance(rig, reported('mount', 'EQUATORIAL_EOD_COORD', { RA: '02:18:00', DEC: 45 }))
    const missing = advance(rig, reported('focuser', 'FOCUS_TEMPERATURE', {}, 'Ok', 'def'))

    for (const result of [wrongType, missing]) expect(Result.isFailure(result) && result.failure._tag).toBe('MalformedReading')
  })

  it('leaves a property the schema does not name, and a device it does not name, out', () => {
    const state = foldRig([reported('mount', 'ON_COORD_SET', { SLEW: false, TRACK: true }), reported('weather', 'WEATHER_STATUS', { OK: 1 })], rig)

    expect(state.devices).toEqual(rig.devices)
  })

  it('forgets a deleted property, and everything when the rig reconnects', () => {
    expect(foldRig([reported('mount', 'TELESCOPE_PARK', {}, 'Idle', 'del')], rig).devices.mount.TELESCOPE_PARK).toBeUndefined()
    expect(foldRig([entry('client.connected', 5, { run: 'r2' })], rig).devices).toEqual(noDevices)
  })
})

describe('the rig line selectors', () => {
  it('read the mount, sensor, focuser and dew heaters', () => {
    expect(mountActivity(rig.devices.mount)).toBe('tracking')
    expect(sensorCelsius(rig.devices.primary)).toBe(-10)
    expect(focusPosition(rig.devices.focuser)).toBe(32562)
    expect(dewHeaters(rig.devices.box)).toEqual([
      { channel: 'DEW_CHANNEL_1', label: 'Dew A', percent: 60, on: true, auto: true },
      { channel: 'DEW_CHANNEL_2', label: 'DEW_CHANNEL_2', percent: 40, on: true, auto: false },
    ])
  })

  it('call the mount parked before slewing, slewing before tracking, and say nothing before it has reported', () => {
    expect(mountActivity(foldRig([reported('mount', 'EQUATORIAL_EOD_COORD', { RA: 3, DEC: 45 }, 'Busy')], rig).devices.mount)).toBe('slewing')
    expect(mountActivity(foldRig([reported('mount', 'TELESCOPE_PARK', { PARK: true, UNPARK: false })], rig).devices.mount)).toBe('parked')
    expect(mountActivity(noDevices.mount)).toBeUndefined()
  })

  it('call the mount homing while Home runs, and moving while a nudge holds it, before tracking', () => {
    expect(mountActivity(foldRig([reported('mount', 'TELESCOPE_HOME', { GO: true }, 'Busy')], rig).devices.mount)).toBe('homing')
    expect(mountActivity(foldRig([reported('mount', 'TELESCOPE_MOTION_NS', { MOTION_NORTH: true, MOTION_SOUTH: false }, 'Busy')], rig).devices.mount)).toBe('moving')
    expect(mountActivity(foldRig([reported('mount', 'TELESCOPE_MOTION_WE', { MOTION_WEST: false, MOTION_EAST: false }, 'Idle')], rig).devices.mount)).toBe('tracking')
  })
})
