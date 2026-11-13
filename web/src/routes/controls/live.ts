import { Schema } from 'effect'
import { altitudeDegrees } from '../../../../state/altitude.ts'
import type { CalibrationSet } from '../../../../state/calibration.ts'
import type { CalibrationType } from '../../../../state/entries.ts'
import { flip } from '../../../../state/flip.ts'
import type { Guiding } from '../../../../state/guiding.ts'
import { dewHeaters, focusPosition, mountActivity, sensorCelsius, type Box, type Mount, type Primary } from '../../../../state/devices.ts'
import type { RigState } from '../../../../state/rig.ts'
import type { Run } from '../../../../state/run.ts'
import type { Reading } from '../../components/Readings.tsx'
import { clockTime } from '../../rig/clock.ts'
import { duration, flipWord, guiderWords, guidingWord, mountWords, unknown } from '../../rig/words.ts'
import { liveBringUp } from '../launch/live.ts'

export const AreaId = Schema.Literals(['mount', 'guiding', 'focus', 'camera', 'dew', 'calibration', 'system'])

export type AreaId = typeof AreaId.Type

const isAreaId = Schema.is(AreaId)

const isShutDownAsked = Schema.is(Schema.Literal('shut-down'))

export interface ControlsAddress {
  readonly opened: AreaId | undefined
  readonly asking: boolean
}

export const controlsAddress = (area: string | undefined, ask: string | null): ControlsAddress => ({ opened: isAreaId(area) ? area : undefined, asking: isShutDownAsked(ask) })

export interface AreaState {
  readonly heading: string
  readonly summary: string
  readonly readings: ReadonlyArray<Reading>
}

const upper = (text: string) => text.toUpperCase()

const sexagesimal = (value: number, withSeconds: boolean) => {
  const whole = Math.abs(value)
  const total = Math.round(whole * (withSeconds ? 3600 : 60))
  const units = withSeconds ? [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60] : [Math.floor(total / 60), total % 60]

  return units.map(unit => String(unit).padStart(2, '0')).join(' ')
}

const onOff = (value: boolean | undefined) => (value === true ? 'ON' : value === false ? 'OFF' : unknown)

function mountArea(mount: Mount, now: number | undefined): AreaState {
  const activity = mountActivity(mount)
  const ra = mount.EQUATORIAL_EOD_COORD?.values.RA
  const dec = mount.EQUATORIAL_EOD_COORD?.values.DEC
  const altitude = altitudeDegrees(mount, now)
  const pier = mount.TELESCOPE_PIER_SIDE?.values
  const toFlip = flip(mount, now)

  return {
    heading: 'Mount',
    summary: activity === undefined ? unknown : mountWords[activity],
    readings: [
      { label: 'Tracking', value: onOff(mount.TELESCOPE_TRACK_STATE?.values.TRACK_ON) },
      { label: 'Pier side', value: pier?.PIER_WEST === true ? 'WEST' : pier?.PIER_EAST === true ? 'EAST' : unknown },
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
  const position = focusPosition(rig.devices.focuser)
  const celsius = rig.devices.focuser.FOCUS_TEMPERATURE?.values.TEMPERATURE
  const hfd = [...rig.frames].reverse().find(frame => frame.measurements?.hfdPixels != null)?.measurements?.hfdPixels

  return {
    heading: 'Focus',
    summary: rig.devices.focuser.ABS_FOCUS_POSITION?.state === 'Busy' ? 'Moving' : position === undefined ? unknown : String(position),
    readings: [
      { label: 'Position', value: position === undefined ? unknown : String(position) },
      { label: 'Temp', value: celsius === undefined ? unknown : `${celsius.toFixed(0)} °C` },
      { label: 'HFD', value: hfd == null ? unknown : `${hfd.toFixed(2)} px` },
    ],
  }
}

function cameraArea(primary: Primary): AreaState {
  const sensor = sensorCelsius(primary)
  const cooler = primary.CCD_COOLER?.values.COOLER_ON
  const power = primary.CCD_COOLER_POWER?.values.CCD_COOLER_VALUE
  const gain = primary.CCD_CONTROLS?.values['Gain']
  const offset = primary.CCD_CONTROLS?.values['Offset']

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

function dewArea(box: Box): AreaState {
  const heaters = dewHeaters(box).map(heater => ({ label: heater.label, value: `${heater.auto ? 'AUTO ' : ''}${heater.percent.toFixed(0)} %` }))
  const weather = box.WEATHER_PARAMETERS?.values
  const air = weather?.WEATHER_TEMPERATURE
  const humidity = weather?.WEATHER_HUMIDITY

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
    mount: mountArea(rig.devices.mount, now),
    guiding: guidingArea(rig.guiding),
    focus: focusArea(rig),
    camera: cameraArea(rig.devices.primary),
    dew: dewArea(rig.devices.box),
    calibration: calibrationArea(rig.calibration),
    system: systemArea(rig, rigUp, now),
  }
}

export const runFacts = (run: Run | undefined): ReadonlyArray<string> => (run?.status === 'capturing' ? ['Run active', run.object, `Frame ${run.frames}`] : ['No run'])
