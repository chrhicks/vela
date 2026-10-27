import type { HorizonStatus, HorizonWindow, TargetSkyPath } from '@vela/model/web'
import { skyTime } from './sky-time'

type Sample = TargetSkyPath['samples'][number]

/** The part of the night worth observing in: above the horizon and in astronomical darkness. */
const planned = (sample: Sample) => sample.altitudeDegrees > 0 && sample.sunAltitudeDegrees < -18

export interface HorizonRun {
  /** Sample indexes, inclusive. A sample's status covers the stretch to the next sample. */
  from: number
  to: number
}

export function horizonRuns(sky: TargetSkyPath, status: HorizonStatus): HorizonRun[] {
  const runs: HorizonRun[] = []

  sky.samples.forEach((sample, index) => {
    if (!planned(sample) || sample.horizon !== status) return
    const last = runs.at(-1)

    if (last && last.to === index - 1) last.to = index
    else runs.push({ from: index, to: index })
  })

  return runs
}

const minutes = (value: number) =>
  value < 60 ? `${value} min` : `${Math.floor(value / 60)} h${value % 60 ? ` ${value % 60} min` : ''}`

/** Lines under the altitude trace. Empty without a profile, and for a night that is clear. */
export function horizonNote(sky: TargetSkyPath): string[] {
  const spans = (status: HorizonStatus) =>
    horizonRuns(sky, status)
      .map(({ from, to }) => `${skyTime(sky.samples[from]!.at)}–${skyTime(sky.samples[Math.min(to + 1, sky.samples.length - 1)]!.at)}`)
      .join(', ')

  const behind = spans('behind')
  const unknown = spans('unknown')

  return [
    ...(behind ? [`May be behind trees ${behind}.`] : []),
    ...(unknown ? [`Horizon untraced ${unknown}.`] : []),
  ]
}

/** Lines for a target card's observing window. Empty without a profile, and for a clear window. */
export function horizonWindowNote(window: HorizonWindow | null): string[] {
  if (!window) return []

  return [
    ...(window.behindMinutes > 0 ? [`May be behind trees for ${minutes(window.behindMinutes)}`] : []),
    ...(window.unknownMinutes > 0 ? [`Horizon untraced for ${minutes(window.unknownMinutes)}`] : []),
  ]
}
