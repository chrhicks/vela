import { SiderealTime } from 'astronomy-engine'
import { makePrepareView, type PrepareView } from '../prepare/view.ts'
import type { Value } from '../stream/entry.ts'
import type { Picture, Property } from './picture.ts'

export type Status = 'current' | 'stale' | 'unknown'

export interface Field {
  readonly label: string
  readonly text: string
  readonly status: Status
  readonly changedAt: number | undefined
}

export interface DeviceView {
  readonly id: string
  readonly title: string
  readonly connection: { readonly text: string; readonly status: Status }
  readonly fields: ReadonlyArray<Field>
}

export type Phase = 'loading' | 'no-connection' | 'silent' | 'live'

export interface Night {
  readonly at: number
  readonly phase: Phase
  readonly rig: { readonly connectedAt: number | undefined; readonly connection: number | undefined; readonly indiserver: string; readonly silentSeconds: number | undefined }
  readonly devices: ReadonlyArray<DeviceView>
  readonly prepare: PrepareView
}

export interface DeviceIds {
  readonly mount: string
  readonly primary: string
  readonly guide: string
  readonly focuser: string
  readonly box: string
}

export interface NightSettings {
  readonly devices: DeviceIds
  readonly silenceMs: number
  readonly focuserNudgeSteps: number
}

interface Reading {
  readonly value: Value | undefined
  readonly status: Status
  readonly changedAt: number | undefined
}

const siderealSecondsPerSecond = 1.0027379093
const unknownText = '—'

function hours(value: number) {
  const whole = Math.floor(value)
  const minutes = Math.round((value - whole) * 60)

  return minutes === 60 ? { whole: whole + 1, minutes: 0 } : { whole, minutes }
}

export function formatRa(raHours: number) {
  const total = Math.round((((raHours % 24) + 24) % 24) * 3600) % 86400
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60

  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
}

export function formatDec(degrees: number) {
  const total = Math.round(Math.abs(degrees) * 3600)
  const d = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60

  return `${degrees < 0 ? '-' : '+'}${String(d).padStart(2, '0')}° ${String(m).padStart(2, '0')}′ ${String(s).padStart(2, '0')}″`
}

export function formatDuration(seconds: number) {
  const { whole, minutes } = hours(Math.abs(seconds) / 3600)

  return whole === 0 ? `${minutes} min` : `${whole} h ${String(minutes).padStart(2, '0')} min`
}

function worst(statuses: ReadonlyArray<Status>): Status {
  return statuses.includes('unknown') ? 'unknown' : statuses.includes('stale') ? 'stale' : 'current'
}

export function makeNight(picture: Picture, settings: NightSettings, now: number): Night {
  const rig = picture.rig()
  const heardAt = picture.heardAt()
  const silentMs = heardAt === undefined ? undefined : now - heardAt
  const silent = silentMs !== undefined && silentMs > settings.silenceMs
  const phase: Phase = !picture.isReady() ? 'loading' : rig === undefined ? 'no-connection' : silent ? 'silent' : 'live'

  function connected(device: string): boolean | undefined {
    const property = picture.property(device, 'CONNECTION')
    const on = property?.values['CONNECT']

    return typeof on === 'boolean' ? on : undefined
  }

  function readingOf(device: string, property: Property | undefined, element: string): Reading {
    const value = property?.values[element]

    if (property === undefined || value === undefined) return { value: undefined, status: 'unknown', changedAt: undefined }

    const link = connected(device) === false || picture.indi() === 'closed' || phase === 'silent' || phase === 'loading'

    return { value, status: link ? 'stale' : 'current', changedAt: property.changedAt }
  }

  function read(device: string, name: string, element: string): Reading {
    return readingOf(device, picture.property(device, name), element)
  }

  function field(label: string, reading: Reading, text: (value: Value) => string): Field {
    return { label, text: reading.value === undefined ? unknownText : text(reading.value), status: reading.status, changedAt: reading.changedAt }
  }

  function number(label: string, reading: Reading, digits: number, unit: string): Field {
    return field(label, reading, value => (typeof value === 'number' ? `${value.toFixed(digits)}${unit}` : unknownText))
  }

  function combined(label: string, readings: ReadonlyArray<Reading>, text: () => string): Field {
    const status = worst(readings.map(reading => reading.status))
    const changedAt = readings.reduce<number | undefined>((latest, reading) => (reading.changedAt === undefined ? latest : Math.max(latest ?? 0, reading.changedAt)), undefined)

    return { label, text: status === 'unknown' ? unknownText : text(), status, changedAt }
  }

  function device(id: string, title: string, deviceId: string, fields: ReadonlyArray<Field>): DeviceView {
    const link = connected(deviceId)
    const known = phase === 'loading' || link === undefined

    return {
      id,
      title,
      connection: { text: link === undefined ? unknownText : link ? 'connected' : 'disconnected', status: known ? 'unknown' : phase === 'silent' ? 'stale' : 'current' },
      fields,
    }
  }

  function onOff(label: string, deviceId: string, name: string, on: string): Field {
    return field(label, read(deviceId, name, on), value => (value === true ? 'on' : 'off'))
  }

  function meridian(): Field {
    const ids = settings.devices
    const tracking = read(ids.mount, 'TELESCOPE_TRACK_STATE', 'TRACK_ON')
    const ra = read(ids.mount, 'EQUATORIAL_EOD_COORD', 'RA')
    const longitude = read(ids.mount, 'GEOGRAPHIC_COORD', 'LONG')
    const limit = read(ids.mount, 'MERIDIAN_LIMIT', 'LIMIT')

    return combined('Meridian limit', [tracking, ra, longitude, limit], () => {
      if (tracking.value !== true) return 'not tracking'
      if (typeof ra.value !== 'number' || typeof longitude.value !== 'number' || typeof limit.value !== 'number') return unknownText

      const localSiderealHours = SiderealTime(new Date(now)) + longitude.value / 15
      const hourAngle = ((((localSiderealHours - ra.value) % 24) + 36) % 24) - 12
      const secondsLeft = ((limit.value / 15 - hourAngle) * 3600) / siderealSecondsPerSecond

      return secondsLeft >= 0 ? `in ${formatDuration(secondsLeft)}` : `reached, ${formatDuration(secondsLeft)} past`
    })
  }

  const ids = settings.devices

  const mountState = combined(
    'Mount',
    [read(ids.mount, 'TELESCOPE_PARK', 'PARK'), read(ids.mount, 'EQUATORIAL_EOD_COORD', 'RA')],
    () => (picture.property(ids.mount, 'TELESCOPE_PARK')?.values['PARK'] === true ? 'parked' : picture.property(ids.mount, 'EQUATORIAL_EOD_COORD')?.state === 'Busy' ? 'slewing' : 'idle'),
  )

  const exposure = read(ids.primary, 'CCD_EXPOSURE', 'CCD_EXPOSURE_VALUE')
  const exposureProperty = picture.property(ids.primary, 'CCD_EXPOSURE')
  const setpoint = picture.written(ids.primary, 'CCD_TEMPERATURE')?.values['CCD_TEMPERATURE_VALUE']
  const setpointStatus: Status = typeof setpoint === 'number' ? (phase === 'live' ? 'current' : 'stale') : 'unknown'
  const guideExposure = picture.property(ids.guide, 'CCD_EXPOSURE')
  const focusMotion = picture.property(ids.focuser, 'ABS_FOCUS_POSITION')
  const phd2 = picture.phd2()
  const dewLabels = picture.property(ids.box, 'DEW_LABELS')
  const dewDuty = picture.property(ids.box, 'DEW_DUTY_CYCLES')
  const dewChannels = Object.keys(dewDuty?.values ?? {}).sort()

  const uploadModes: Readonly<Record<string, string>> = { UPLOAD_CLIENT: 'to the client', UPLOAD_LOCAL: 'on the camera computer', UPLOAD_BOTH: 'both' }
  const uploadProperty = picture.property(ids.primary, 'UPLOAD_MODE')
  const uploadSelected = Object.entries(uploadProperty?.values ?? {}).find(([, value]) => value === true)?.[0]
  const uploadReading = readingOf(ids.primary, uploadSelected === undefined ? undefined : uploadProperty, uploadSelected ?? '')

  const phd2Status: Status = phd2.link === 'connected' && phd2.state !== undefined ? (phase === 'live' ? 'current' : 'stale') : 'unknown'

  const devices: ReadonlyArray<DeviceView> = [
    device('mount', 'Mount', ids.mount, [
      field('RA', read(ids.mount, 'EQUATORIAL_EOD_COORD', 'RA'), value => (typeof value === 'number' ? formatRa(value) : unknownText)),
      field('Dec', read(ids.mount, 'EQUATORIAL_EOD_COORD', 'DEC'), value => (typeof value === 'number' ? formatDec(value) : unknownText)),
      field('Tracking', read(ids.mount, 'TELESCOPE_TRACK_STATE', 'TRACK_ON'), value => (value === true ? 'on' : 'off')),
      field('Pier side', read(ids.mount, 'TELESCOPE_PIER_SIDE', 'PIER_WEST'), value => (value === true ? 'west' : 'east')),
      mountState,
      meridian(),
    ]),
    device('primary', 'Main camera', ids.primary, [
      number('Sensor temperature', read(ids.primary, 'CCD_TEMPERATURE', 'CCD_TEMPERATURE_VALUE'), 1, ' °C'),
      onOff('Cooler', ids.primary, 'CCD_COOLER', 'COOLER_ON'),
      number('Cooler power', read(ids.primary, 'CCD_COOLER_POWER', 'CCD_COOLER_VALUE'), 0, ' %'),
      {
        label: 'Setpoint (last written)',
        text: typeof setpoint === 'number' ? `${setpoint.toFixed(1)} °C` : unknownText,
        status: setpointStatus,
        changedAt: picture.written(ids.primary, 'CCD_TEMPERATURE')?.at,
      },
      field('Exposure', exposure, value =>
        exposureProperty?.state === 'Busy' && typeof value === 'number' ? `exposing, ${value.toFixed(1)} s left` : exposureProperty?.state === 'Alert' ? 'failed' : 'idle',
      ),
      number('Gain', read(ids.primary, 'CCD_CONTROLS', 'Gain'), 0, ''),
      number('Offset', read(ids.primary, 'CCD_CONTROLS', 'Offset'), 0, ''),
      field('Upload mode', uploadReading, () => uploadModes[uploadSelected ?? ''] ?? uploadSelected ?? unknownText),
    ]),
    device('guide', 'Guide camera', ids.guide, [
      field('Exposing', read(ids.guide, 'CCD_EXPOSURE', 'CCD_EXPOSURE_VALUE'), () => (guideExposure?.state === 'Busy' ? 'yes' : 'no')),
    ]),
    device('focuser', 'Focuser', ids.focuser, [
      number('Position', read(ids.focuser, 'ABS_FOCUS_POSITION', 'FOCUS_ABSOLUTE_POSITION'), 0, ' steps'),
      number('Temperature', read(ids.focuser, 'FOCUS_TEMPERATURE', 'TEMPERATURE'), 1, ' °C'),
      field('Moving', read(ids.focuser, 'ABS_FOCUS_POSITION', 'FOCUS_ABSOLUTE_POSITION'), () => (focusMotion?.state === 'Busy' ? 'yes' : 'no')),
    ]),
    device('box', 'Power box', ids.box, [
      number('Input voltage', read(ids.box, 'POWER_SENSORS', 'SENSOR_VOLTAGE'), 1, ' V'),
      number('Current', read(ids.box, 'POWER_SENSORS', 'SENSOR_CURRENT'), 2, ' A'),
      ...(dewChannels.length === 0
        ? [{ label: 'Dew heaters', text: unknownText, status: 'unknown' as const, changedAt: undefined }]
        : dewChannels.map(channel => {
            const label = dewLabels?.values[channel]

            return number(`Dew heater ${typeof label === 'string' && label !== '' ? label : channel}`, readingOf(ids.box, dewDuty, channel), 0, ' %')
          })),
    ]),
    {
      id: 'phd2',
      title: 'PHD2',
      connection: {
        text: phd2.link === 'unknown' ? unknownText : phd2.link === 'connected' ? 'connected' : 'not reachable',
        status: phd2.link === 'unknown' ? 'unknown' : phase === 'live' ? 'current' : 'stale',
      },
      fields: [
        { label: 'State', text: phd2.state ?? unknownText, status: phd2Status, changedAt: phd2.changedAt },
        {
          label: 'Last guide step',
          text: phd2.lastStepAt === undefined ? unknownText : `${formatDuration((now - phd2.lastStepAt) / 1000)} ago`,
          status: phd2.lastStepAt === undefined ? 'unknown' : phd2Status === 'unknown' ? 'stale' : phd2Status,
          changedAt: phd2.lastStepAt,
        },
      ],
    },
  ]

  return {
    at: now,
    phase,
    rig: {
      connectedAt: rig?.at,
      connection: rig?.connection,
      indiserver: picture.indi(),
      silentSeconds: silentMs === undefined ? undefined : Math.floor(silentMs / 1000),
    },
    devices,
    prepare: makePrepareView(picture, { focuser: ids.focuser, box: ids.box, focuserNudgeSteps: settings.focuserNudgeSteps }),
  }
}
