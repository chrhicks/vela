import { SiderealTime } from 'astronomy-engine'
import { describe, expect, it } from 'vitest'
import { connected, indiserver, inRun, phd2, phd2Link, phoenixLongitude, startedAt, wire } from '../testing/entries.ts'
import { formatDec, formatRa, makeNight, type DeviceView, type Night } from './night.ts'
import { makePicture, type Picture } from './picture.ts'

const t = (seconds: number) => startedAt + seconds * 1000

const settings = { devices: { mount: 'mount', primary: 'primary', guide: 'guide', focuser: 'focuser', box: 'box' }, silenceMs: 10_000 }

function define(picture: Picture, at: number, device: string, property: string, elements: Readonly<Record<string, number | boolean | string>>, state = 'Ok') {
  picture.apply(wire(at, 'def', device, property, elements, state), at)
}

function rigWithAll(): Picture {
  const picture = makePicture()

  picture.apply(connected(t(0)), t(0))
  picture.apply(indiserver(t(0), 'connected'), t(0))

  for (const device of ['mount', 'primary', 'guide', 'focuser', 'box']) define(picture, t(1), device, 'CONNECTION', { CONNECT: true, DISCONNECT: false })

  define(picture, t(1), 'mount', 'EQUATORIAL_EOD_COORD', { RA: 5.5, DEC: -5.25 })
  define(picture, t(1), 'mount', 'TELESCOPE_TRACK_STATE', { TRACK_ON: true, TRACK_OFF: false })
  define(picture, t(1), 'mount', 'TELESCOPE_PIER_SIDE', { PIER_WEST: true, PIER_EAST: false })
  define(picture, t(1), 'mount', 'TELESCOPE_PARK', { PARK: false, UNPARK: true })
  define(picture, t(1), 'mount', 'GEOGRAPHIC_COORD', { LAT: 33.45, LONG: phoenixLongitude, ELEV: 331 })
  define(picture, t(1), 'mount', 'MERIDIAN_LIMIT', { LIMIT: 5 })
  define(picture, t(1), 'primary', 'CCD_TEMPERATURE', { CCD_TEMPERATURE_VALUE: -9.84 })
  define(picture, t(1), 'primary', 'CCD_COOLER', { COOLER_ON: true, COOLER_OFF: false })
  define(picture, t(1), 'primary', 'CCD_COOLER_POWER', { CCD_COOLER_VALUE: 63.2 })
  define(picture, t(1), 'primary', 'CCD_EXPOSURE', { CCD_EXPOSURE_VALUE: 0 })
  define(picture, t(1), 'primary', 'CCD_CONTROLS', { Gain: 100, Offset: 50, BandWidth: 40 })
  define(picture, t(1), 'primary', 'UPLOAD_MODE', { UPLOAD_CLIENT: false, UPLOAD_LOCAL: true, UPLOAD_BOTH: false })
  define(picture, t(1), 'guide', 'CCD_EXPOSURE', { CCD_EXPOSURE_VALUE: 0 })
  define(picture, t(1), 'focuser', 'ABS_FOCUS_POSITION', { FOCUS_ABSOLUTE_POSITION: 21450 })
  define(picture, t(1), 'focuser', 'FOCUS_TEMPERATURE', { TEMPERATURE: 8.46 })
  define(picture, t(1), 'box', 'POWER_SENSORS', { SENSOR_VOLTAGE: 12.9, SENSOR_CURRENT: 0.785, SENSOR_POWER: 10.1 })
  define(picture, t(1), 'box', 'DEW_DUTY_CYCLES', { DEW_CHANNEL_1: 40, DEW_CHANNEL_2: 0 })
  define(picture, t(1), 'box', 'DEW_LABELS', { DEW_CHANNEL_1: 'Dew A', DEW_CHANNEL_2: 'Dew B' })
  picture.apply(wire(t(2), 'new', 'primary', 'CCD_TEMPERATURE', { CCD_TEMPERATURE_VALUE: -10 }), t(2))
  picture.apply(phd2Link(t(2), 'connected'), t(2))
  picture.apply(phd2(t(3), { Event: 'AppState', State: 'Guiding' }), t(3))
  picture.caughtUp()

  return picture
}

const deviceOf = (night: Night, id: string): DeviceView => {
  const found = night.devices.find(device => device.id === id)

  if (found === undefined) throw new Error(`no device ${id}`)

  return found
}

const texts = (device: DeviceView) => Object.fromEntries(device.fields.map(field => [field.label, field.text]))

describe('night', () => {
  it('shows what a night needs, grouped by device', () => {
    const night = makeNight(rigWithAll(), settings, t(5))

    expect(night.phase).toBe('live')
    expect(night.rig).toEqual({ connectedAt: t(0), connection: 1, indiserver: 'connected', silentSeconds: 2 })
    expect(night.devices.map(device => device.id)).toEqual(['mount', 'primary', 'guide', 'focuser', 'box', 'phd2'])
    expect(deviceOf(night, 'mount').connection).toEqual({ text: 'connected', status: 'current' })
    expect(texts(deviceOf(night, 'mount'))).toMatchObject({ RA: '05h 30m 00s', Dec: '-05° 15′ 00″', Tracking: 'on', 'Pier side': 'west', Mount: 'idle' })
    expect(texts(deviceOf(night, 'primary'))).toEqual({
      'Sensor temperature': '-9.8 °C',
      Cooler: 'on',
      'Cooler power': '63 %',
      'Setpoint (last written)': '-10.0 °C',
      Exposure: 'idle',
      Gain: '100',
      Offset: '50',
      'Upload mode': 'on the camera computer',
    })
    expect(texts(deviceOf(night, 'guide'))).toEqual({ Exposing: 'no' })
    expect(texts(deviceOf(night, 'focuser'))).toEqual({ Position: '21450 steps', Temperature: '8.5 °C', Moving: 'no' })
    expect(texts(deviceOf(night, 'box'))).toEqual({ 'Input voltage': '12.9 V', Current: '0.79 A', 'Dew heater Dew A': '40 %', 'Dew heater Dew B': '0 %' })
    expect(texts(deviceOf(night, 'phd2'))).toEqual({ State: 'Guiding' })
    expect(deviceOf(night, 'mount').fields.every(field => field.status === 'current')).toBe(true)
  })

  it('shows an exposure under way with its time left, a slew, and a focuser move', () => {
    const picture = rigWithAll()

    picture.apply(wire(t(6), 'set', 'primary', 'CCD_EXPOSURE', { CCD_EXPOSURE_VALUE: 41.26 }, 'Busy'), t(6))
    picture.apply(wire(t(6), 'set', 'mount', 'EQUATORIAL_EOD_COORD', { RA: 5.6 }, 'Busy'), t(6))
    picture.apply(wire(t(6), 'set', 'focuser', 'ABS_FOCUS_POSITION', { FOCUS_ABSOLUTE_POSITION: 21500 }, 'Busy'), t(6))
    picture.apply(wire(t(6), 'set', 'guide', 'CCD_EXPOSURE', { CCD_EXPOSURE_VALUE: 1.5 }, 'Busy'), t(6))

    const night = makeNight(picture, settings, t(7))

    expect(texts(deviceOf(night, 'primary'))['Exposure']).toBe('exposing, 41.3 s left')
    expect(texts(deviceOf(night, 'mount'))['Mount']).toBe('slewing')
    expect(texts(deviceOf(night, 'focuser'))['Moving']).toBe('yes')
    expect(texts(deviceOf(night, 'guide'))['Exposing']).toBe('yes')
  })

  it('shows parked, and that the sensor reading has a time of last change', () => {
    const picture = rigWithAll()

    picture.apply(wire(t(8), 'set', 'mount', 'TELESCOPE_PARK', { PARK: true, UNPARK: false }, 'Ok'), t(8))
    picture.apply(wire(t(8), 'set', 'primary', 'CCD_TEMPERATURE', { CCD_TEMPERATURE_VALUE: -9.9 }, 'Ok'), t(8))

    const night = makeNight(picture, settings, t(9))

    expect(texts(deviceOf(night, 'mount'))['Mount']).toBe('parked')
    expect(deviceOf(night, 'primary').fields[0]?.changedAt).toBe(t(8))
  })

  it('marks everything unknown that the rig has not confirmed since its latest connection', () => {
    const picture = rigWithAll()

    picture.apply(connected(t(20), 2, 'run-b'), t(20))
    picture.apply(inRun(wire(t(21), 'def', 'mount', 'TELESCOPE_TRACK_STATE', { TRACK_ON: false, TRACK_OFF: true }, 'Ok'), 'run-b'), t(21))

    const night = makeNight(picture, settings, t(22))
    const mount = deviceOf(night, 'mount')

    expect(mount.fields.find(field => field.label === 'Tracking')).toMatchObject({ text: 'off', status: 'current' })
    expect(mount.fields.find(field => field.label === 'RA')).toMatchObject({ text: '—', status: 'unknown' })
    expect(mount.connection).toEqual({ text: '—', status: 'unknown' })
    expect(deviceOf(night, 'primary').fields.every(field => field.status === 'unknown')).toBe(true)
    expect(deviceOf(night, 'phd2').fields[0]).toMatchObject({ text: '—', status: 'unknown' })
  })

  it('shows every value stale, never current, once the rig program has been silent longer than the setting', () => {
    const picture = rigWithAll()
    const night = makeNight(picture, settings, t(3) + 10_001)

    expect(night.phase).toBe('silent')
    expect(night.rig.silentSeconds).toBe(10)
    expect(deviceOf(night, 'mount').fields.find(field => field.label === 'RA')).toMatchObject({ text: '05h 30m 00s', status: 'stale' })
    expect(deviceOf(night, 'mount').connection.status).toBe('stale')
    expect(night.devices.flatMap(device => device.fields).every(field => field.status !== 'current')).toBe(true)
  })

  it('is not stale just under the setting', () => {
    expect(makeNight(rigWithAll(), settings, t(3) + 10_000).phase).toBe('live')
  })

  it('shows a disconnected device stale and says so', () => {
    const picture = rigWithAll()

    picture.apply(wire(t(6), 'set', 'focuser', 'CONNECTION', { CONNECT: false, DISCONNECT: true }, 'Ok'), t(6))

    const focuser = deviceOf(makeNight(picture, settings, t(7)), 'focuser')

    expect(focuser.connection).toEqual({ text: 'disconnected', status: 'current' })
    expect(focuser.fields.find(field => field.label === 'Position')).toMatchObject({ text: '21450 steps', status: 'stale' })
  })

  it('shows stale values and an unknown picture when the rig lost indiserver', () => {
    const picture = rigWithAll()

    picture.apply(indiserver(t(6), 'closed'), t(6))

    const night = makeNight(picture, settings, t(7))

    expect(night.rig.indiserver).toBe('closed')
    expect(night.devices.flatMap(device => device.fields).filter(field => field.label !== 'State').every(field => field.status === 'unknown')).toBe(true)
  })

  it('says there is no rig connection when the stream holds none, and loading before the replay is done', () => {
    const empty = makePicture()

    expect(makeNight(empty, settings, t(0)).phase).toBe('loading')

    empty.caughtUp()

    const night = makeNight(empty, settings, t(0))

    expect(night.phase).toBe('no-connection')
    expect(night.devices.flatMap(device => device.fields).every(field => field.status === 'unknown')).toBe(true)
  })

  it('marks PHD2 not reachable when its link is down', () => {
    const picture = rigWithAll()

    picture.apply(phd2Link(t(6), 'failed'), t(6))

    expect(deviceOf(makeNight(picture, settings, t(7)), 'phd2').connection.text).toBe('not reachable')
  })

  describe('meridian limit', () => {
    const at = t(30)
    const localSiderealHours = SiderealTime(new Date(at)) + phoenixLongitude / 15

    function limitWith(hourAngleHours: number) {
      const picture = rigWithAll()

      picture.apply(wire(t(29), 'set', 'mount', 'EQUATORIAL_EOD_COORD', { RA: (((localSiderealHours - hourAngleHours) % 24) + 24) % 24 }), t(29))

      return texts(deviceOf(makeNight(picture, settings, at), 'mount'))['Meridian limit']
    }

    it('counts down to the limit east of the meridian', () => {
      expect(limitWith(-1)).toBe('in 1 h 20 min')
    })

    it('counts down to the limit just west of the meridian', () => {
      expect(limitWith(0.1)).toBe('in 14 min')
    })

    it('says the limit is reached once past it', () => {
      expect(limitWith(1)).toBe('reached, 40 min past')
    })

    it('says so when the mount is not tracking', () => {
      const picture = rigWithAll()

      picture.apply(wire(t(29), 'set', 'mount', 'TELESCOPE_TRACK_STATE', { TRACK_ON: false, TRACK_OFF: true }), t(29))

      expect(texts(deviceOf(makeNight(picture, settings, at), 'mount'))['Meridian limit']).toBe('not tracking')
    })

    it('is unknown without the site longitude', () => {
      const picture = makePicture()

      picture.apply(connected(t(0)), t(0))
      define(picture, t(1), 'mount', 'EQUATORIAL_EOD_COORD', { RA: 5.5, DEC: 0 })
      define(picture, t(1), 'mount', 'TELESCOPE_TRACK_STATE', { TRACK_ON: true, TRACK_OFF: false })
      define(picture, t(1), 'mount', 'MERIDIAN_LIMIT', { LIMIT: 5 })
      picture.caughtUp()

      expect(deviceOf(makeNight(picture, settings, t(2)), 'mount').fields.find(field => field.label === 'Meridian limit')).toMatchObject({ text: '—', status: 'unknown' })
    })
  })
})

describe('formatting', () => {
  it('writes right ascension in hours, minutes and seconds', () => {
    expect(formatRa(0)).toBe('00h 00m 00s')
    expect(formatRa(23.999999)).toBe('00h 00m 00s')
    expect(formatRa(12.5083333)).toBe('12h 30m 30s')
  })

  it('writes declination with its sign', () => {
    expect(formatDec(33.45)).toBe('+33° 27′ 00″')
    expect(formatDec(-0.5)).toBe('-00° 30′ 00″')
  })
})
