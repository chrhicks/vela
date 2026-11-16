import type { Devices } from '../../../../state/devices.ts'
import { focusPosition, mountActivity, sensorCelsius } from '../../../../state/devices.ts'
import type { RunEnding } from '../../../../state/entries.ts'
import type { FirstFramesChecked } from '../../../../state/first-frames.ts'
import type { Frame } from '../../../../state/frames.ts'
import type { Guiding } from '../../../../state/guiding.ts'
import type { Run } from '../../../../state/run.ts'
import type { Reading } from '../../components/Readings.tsx'
import { clockTime } from '../../rig/clock.ts'
import { guidingWord, mountWords, unknown } from '../../rig/words.ts'

const endingWords: Readonly<Record<RunEnding, string>> = {
  done: 'All frames taken',
  stopped: 'Stopped by you',
  failures: 'Stopped on failures',
  refused: 'Refused',
  interrupted: 'Interrupted',
  unknown: 'Ended',
}

export function lastRunFacts(run: Run | undefined): ReadonlyArray<string> {
  if (run === undefined) return ['Nothing run yet tonight']
  if (run.status !== 'ended') return [`Last ${run.object}`]

  return [`Last ${run.object}`, `${run.exposureSeconds} s`, `${clockTime(run.startedAt)} to ${clockTime(run.endedAt)}`, endingWords[run.reason]]
}

export function rigNow(devices: Devices, guiding: Guiding): ReadonlyArray<Reading> {
  const activity = mountActivity(devices.mount)
  const tracking = devices.mount.TELESCOPE_TRACK_STATE?.values.TRACK_ON
  const coolerOn = devices.primary.CCD_COOLER?.values.COOLER_ON
  const sensor = sensorCelsius(devices.primary)
  const focus = focusPosition(devices.focuser)

  return [
    { label: 'Mount', value: activity === undefined ? unknown : mountWords[activity] },
    { label: 'Tracking', value: tracking === undefined ? unknown : tracking ? 'On' : 'Off' },
    { label: 'Guiding', value: guidingWord(guiding) },
    { label: 'Cooler', value: coolerOn === undefined ? unknown : coolerOn ? (sensor === undefined ? 'On' : `${sensor.toFixed(1)} °C`) : 'Off' },
    { label: 'Focus', value: focus === undefined ? unknown : String(focus) },
  ]
}

const imaging = (frame: Frame) => frame.sequence !== undefined && !frame.sequence.startsWith('test-frame')

export const tonightsFrames = (frames: ReadonlyArray<Frame>, night: string | undefined) => frames.filter(frame => frame.night === night && imaging(frame))

export function tonight(frames: ReadonlyArray<Frame>, checked: FirstFramesChecked | undefined, run: Run | undefined): ReadonlyArray<Reading> {
  const targets = new Set(frames.flatMap(frame => (frame.sequence === undefined ? [] : [frame.sequence])))
  const verdict = checked === undefined || checked.run !== run?.id ? unknown : checked.verdict === 'passed' ? 'OK' : 'POOR'

  return [
    { label: 'Frames', value: String(frames.length) },
    { label: 'Targets', value: String(targets.size) },
    { label: 'First frames', value: verdict, attention: verdict === 'POOR' },
  ]
}
