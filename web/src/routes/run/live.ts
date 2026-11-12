import type { Frame } from '../../../../state/frames.ts'
import type { GuiderActivity, Guiding } from '../../../../state/guiding.ts'
import { dewHeaters, focusPosition, mountActivity, sensorCelsius, type MountActivity, type Readings } from '../../../../state/readings.ts'
import type { Run } from '../../../../state/run.ts'
import type { Reading } from '../../components/Readings.tsx'
import type { Capturing } from './stub.ts'

const unknown = '—'

const clock = (at: number, withSeconds = false) =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(withSeconds ? { second: '2-digit' } : {}), hour12: false })

const fixed = (value: number | null, digits: number, unit = '') => (value === null ? unknown : `${value.toFixed(digits)}${unit}`)

const latestMeasured = (frames: ReadonlyArray<Frame>) => [...frames].reverse().find(frame => frame.measurements !== undefined)

function latestStats(frame: Frame | undefined): ReadonlyArray<Reading> {
  const measured = frame?.measurements

  return [
    { label: 'HFD', value: measured === undefined ? unknown : fixed(measured.hfdPixels, 2, ' px') },
    { label: 'Stars', value: measured === undefined ? unknown : fixed(measured.stars, 0) },
    { label: 'Sky', value: measured === undefined ? unknown : fixed(measured.sky, 0) },
    { label: 'Noise', value: measured === undefined ? unknown : fixed(measured.noise, 1) },
    { label: 'Off centre', value: unknown },
    { label: 'Vs baseline', value: unknown },
  ]
}

const mountWords: Readonly<Record<MountActivity, string>> = { parked: 'Parked', slewing: 'Slewing', tracking: 'Tracking', idle: 'Idle' }

const guiderWords: Readonly<Record<GuiderActivity, string>> = {
  guiding: 'On',
  looping: 'Looping',
  calibrating: 'Calibrating',
  starPicked: 'Star picked',
  starLost: 'Star lost',
  paused: 'Paused',
  stopped: 'Off',
}

function guidingWord({ link, activity, averagePixels }: Guiding): string {
  if (link === 'closed') return 'PHD2 off'
  if (activity === undefined) return unknown
  if (activity === 'guiding' && averagePixels !== undefined) return `${guiderWords.guiding} ${averagePixels.toFixed(2)} px`

  return guiderWords[activity]
}

function rigLine(readings: Readings, guiding: Guiding): ReadonlyArray<Reading> {
  const activity = mountActivity(readings)
  const sensor = sensorCelsius(readings)
  const focus = focusPosition(readings)
  const heaters = dewHeaters(readings)

  return [
    { label: 'Mount', value: activity === undefined ? unknown : mountWords[activity] },
    { label: 'Guiding', value: guidingWord(guiding) },
    { label: 'Sensor', value: sensor === undefined ? unknown : `${sensor.toFixed(1)} °C` },
    { label: 'Focus', value: focus === undefined ? unknown : `${focus}` },
    { label: 'Dew', value: heaters.length === 0 ? unknown : `${heaters.map(heater => heater.percent).join(' / ')} %` },
    { label: 'Flip', value: unknown },
  ]
}

export interface Live {
  readonly run: Run | undefined
  readonly frames: ReadonlyArray<Frame>
  readonly readings: Readings
  readonly guiding: Guiding
}

export function liveCapturing({ run, frames, readings, guiding }: Live, placeholder: Capturing): Capturing {
  if (run === undefined) return { ...placeholder, rig: rigLine(readings, guiding) }

  const latest = latestMeasured(frames)

  return {
    ...placeholder,
    rig: rigLine(readings, guiding),
    frame: run.frames,
    facts: [run.object, `${run.exposureSeconds} s`, `Since ${clock(run.startedAt)}`, run.count === undefined ? 'Until stopped' : `${run.count} frames`],
    latest: {
      detail: latest === undefined ? unknown : `${run.frames} · ${clock(latest.keptAt, true)}`,
      stats: latestStats(latest),
    },
  }
}
