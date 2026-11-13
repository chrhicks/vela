import { altitudeDegrees } from '../../../../state/altitude.ts'
import type { CalibrationSet, CalibrationType } from '../../../../state/calibration.ts'
import { flip } from '../../../../state/flip.ts'
import type { Guiding } from '../../../../state/guiding.ts'
import { focusPosition, mountActivity, sensorCelsius, type Readings } from '../../../../state/readings.ts'
import type { RigState } from '../../../../state/rig.ts'
import type { Run } from '../../../../state/run.ts'
import type { Reading } from '../../components/Readings.tsx'
import { clockTime } from '../../rig/clock.ts'
import { duration, flipWord, guiderWords, guidingWord, mountWords, unknown } from '../../rig/words.ts'
import { liveBringUp } from '../launch/live.ts'

export const areaIds = ['mount', 'guiding', 'focus', 'camera', 'dew', 'calibration', 'system'] as const

export type AreaId = (typeof areaIds)[number]

export interface AreaState {
  readonly heading: string
  readonly summary: string
  readonly readings: ReadonlyArray<Reading>
}

const valueOf = (readings: Readings, device: string, property: string, element: string) => readings[device]?.[property]?.values[element]

const numberOf = (readings: Readings, device: string, property: string, element: string) => {
  const value = valueOf(readings, device, property, element)

  return typeof value === 'number' ? value : undefined
}

const upper = (text: string) => text.toUpperCase()

const sexagesimal = (value: number, withSeconds: boolean) => {
  const whole = Math.abs(value)
  const total = Math.round(whole * (withSeconds ? 3600 : 60))
  const units = withSeconds ? [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60] : [Math.floor(total / 60), total % 60]

  return units.map(unit => String(unit).padStart(2, '0')).join(' ')
}

const onOff = (value: unknown) => (value === true ? 'ON' : value === false ? 'OFF' : unknown)

function mountArea(readings: Readings, now: number | undefined): AreaState {
  const activity = mountActivity(readings)
  const ra = numberOf(readings, 'mount', 'EQUATORIAL_EOD_COORD', 'RA')
  const dec = numberOf(readings, 'mount', 'EQUATORIAL_EOD_COORD', 'DEC')
  const altitude = altitudeDegrees(readings, now)
  const pier = readings['mount']?.['TELESCOPE_PIER_SIDE']?.values
  const toFlip = flip(readings, now)

  return {
    heading: 'Mount',
    summary: activity === undefined ? unknown : mountWords[activity],
    readings: [
      { label: 'Tracking', value: onOff(valueOf(readings, 'mount', 'TELESCOPE_TRACK_STATE', 'TRACK_ON')) },
      { label: 'Pier side', value: pier?.['PIER_WEST'] === true ? 'WEST' : pier?.['PIER_EAST'] === true ? 'EAST' : unknown },
      { label: 'RA', value: ra === undefined ? unknown : sexagesimal(ra, true) },
      { label: 'Dec', value: dec === undefined ? unknown : `${dec < 0 ? '-' : '+'}${sexagesimal(dec, false)}` },
      { label: 'Alt', value: altitude === undefined ? unknown : `${Math.round(altitude)}°` },
      { label: 'To flip', value: upper(toFlip._tag === 'In' ? duration(toFlip.seconds) : flipWord(toFlip)) },
    ],
  }
}

function guidingArea(guiding: Guiding): AreaState {
  const phd2 = guiding.link === 'closed' ? 'Off' : guiding.activity === undefined ? unknown : guiderWords[guiding.activity]

  return {
    heading: 'Guiding',
    summary: guidingWord(guiding),
    readings: [
      { label: 'PHD2', value: upper(phd2) },
      { label: 'Error', value: guiding.averagePixels === undefined ? unknown : `${guiding.averagePixels.toFixed(2)} px` },
      { label: 'Star SNR', value: guiding.starSnr === undefined ? unknown : guiding.starSnr.toFixed(0) },
    ],
  }
}

function focusArea(rig: RigState): AreaState {
  const position = focusPosition(rig.readings)
  const celsius = numberOf(rig.readings, 'focuser', 'FOCUS_TEMPERATURE', 'TEMPERATURE')
  const hfd = [...rig.frames].reverse().find(frame => frame.measurements?.hfdPixels != null)?.measurements?.hfdPixels

  return {
    heading: 'Focus',
    summary: position === undefined ? unknown : String(position),
    readings: [
      { label: 'Position', value: position === undefined ? unknown : String(position) },
      { label: 'Temp', value: celsius === undefined ? unknown : `${celsius.toFixed(0)} °C` },
      { label: 'HFD', value: hfd == null ? unknown : `${hfd.toFixed(2)} px` },
    ],
  }
}

function cameraArea(readings: Readings): AreaState {
  const sensor = sensorCelsius(readings)
  const cooler = valueOf(readings, 'primary', 'CCD_COOLER', 'COOLER_ON')
  const power = numberOf(readings, 'primary', 'CCD_COOLER_POWER', 'CCD_COOLER_VALUE')
  const gain = numberOf(readings, 'primary', 'CCD_CONTROLS', 'Gain')
  const offset = numberOf(readings, 'primary', 'CCD_CONTROLS', 'Offset')

  return {
    heading: 'Camera',
    summary: sensor === undefined ? unknown : `${sensor.toFixed(1)} °C`,
    readings: [
      { label: 'Sensor', value: sensor === undefined ? unknown : `${sensor.toFixed(1)} °C` },
      { label: 'Cooler', value: cooler === true && power !== undefined ? `ON ${power.toFixed(0)} %` : onOff(cooler) },
      { label: 'Gain', value: gain === undefined ? unknown : String(gain) },
      { label: 'Offset', value: offset === undefined ? unknown : String(offset) },
    ],
  }
}

function dewArea(readings: Readings): AreaState {
  const box = readings['box']
  const duty = box?.['DEW_DUTY_CYCLES']?.values ?? {}
  const labels = box?.['DEW_LABELS']?.values ?? {}
  const auto = box?.['AUTO_DEW_CONTROL']?.values ?? {}
  const heaters = Object.keys(duty)
    .sort()
    .flatMap(channel => {
      const percent = duty[channel]
      const label = labels[channel]

      return typeof percent === 'number' ? [{ label: typeof label === 'string' && label !== '' ? label : channel, value: `${auto[channel] === true ? 'AUTO ' : ''}${percent.toFixed(0)} %` }] : []
    })
  const air = numberOf(readings, 'box', 'WEATHER_PARAMETERS', 'WEATHER_TEMPERATURE')
  const humidity = numberOf(readings, 'box', 'WEATHER_PARAMETERS', 'WEATHER_HUMIDITY')

  return {
    heading: 'Dew heater',
    summary: heaters[0] === undefined ? unknown : heaters[0].value.toLowerCase().replace('auto', 'Auto'),
    readings: [...heaters, { label: 'Air', value: air === undefined || humidity === undefined ? unknown : `${air.toFixed(1)} °C ${humidity.toFixed(0)} %` }],
  }
}

const calibrationWords: Readonly<Record<CalibrationType, string>> = { dark: 'Darks', flat: 'Flats', bias: 'Bias' }

function calibrationArea(set: CalibrationSet | undefined): AreaState {
  const said = set === undefined ? 'None tonight' : `${calibrationWords[set.frameType]} ${set.frames}`

  return {
    heading: 'Calibration',
    summary: said,
    readings: [{ label: 'Last set', value: upper(set === undefined ? said : `${said} · ${clockTime(set.startedAt)}`) }],
  }
}

function systemArea(rig: RigState, rigUp: boolean, now: number | undefined): AreaState {
  const states = liveBringUp(rig, rigUp).map(device => device.state)
  const set = states.filter(state => state === 'set' || state === 'up').length
  const upFor = rigUp && rig.connectedAt !== undefined && now !== undefined ? duration(Math.max(0, now - rig.connectedAt) / 1000) : undefined

  return {
    heading: 'System',
    summary: `${set} of ${states.length} set`,
    readings: [
      { label: 'Rig PC', value: rigUp ? upper(upFor === undefined ? 'Up' : `Up ${upFor}`) : 'NOT HEARD' },
      { label: 'Rig program', value: rigUp ? 'RUNNING' : 'SILENT' },
      { label: 'Devices', value: `${set} OF ${states.length} SET` },
    ],
  }
}

export function liveAreas(rig: RigState, rigUp: boolean, now: number | undefined): Readonly<Record<AreaId, AreaState>> {
  return {
    mount: mountArea(rig.readings, now),
    guiding: guidingArea(rig.guiding),
    focus: focusArea(rig),
    camera: cameraArea(rig.readings),
    dew: dewArea(rig.readings),
    calibration: calibrationArea(rig.calibration),
    system: systemArea(rig, rigUp, now),
  }
}

export const runFacts = (run: Run | undefined): ReadonlyArray<string> => (run?.status === 'capturing' ? ['Run active', run.object, `Frame ${run.frames}`] : ['No run'])
