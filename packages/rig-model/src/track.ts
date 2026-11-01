import type { EpochMs } from '@vela/rig-events'
import { angularDistance } from '@vela/rig-sky'
import type { MountFrame } from './observation.ts'
import type { PierSide } from './mount-position.ts'

/** The mount as last read, from `at` until the next sample. */
export interface MountSample {
  readonly at: EpochMs
  readonly raHours: number
  readonly decDegrees: number
  readonly frame: MountFrame
  readonly slewing: boolean
  readonly tracking: boolean
  readonly pierSide: PierSide
  readonly fresh: boolean
}

/**
 * A step function plus how far it is vouched for. The value holds until the next sample; `coveredUntil` is the newest snapshot time, which is what tells a
 * calm mount from a silent stream.
 */
export interface MountTrack {
  readonly samples: readonly MountSample[]
  readonly coveredUntil: EpochMs | null
}

export const emptyTrack: MountTrack = { samples: [], coveredUntil: null }

export function sameReading(a: MountSample, b: MountSample): boolean {
  return (
    a.raHours === b.raHours &&
    a.decDegrees === b.decDegrees &&
    a.frame === b.frame &&
    a.slewing === b.slewing &&
    a.tracking === b.tracking &&
    a.pierSide === b.pierSide &&
    a.fresh === b.fresh
  )
}

export function separationDegrees(a: Pick<MountSample, 'raHours' | 'decDegrees'>, b: Pick<MountSample, 'raHours' | 'decDegrees'>): number {
  return angularDistance({ raDegrees: a.raHours * 15, decDegrees: a.decDegrees }, { raDegrees: b.raHours * 15, decDegrees: b.decDegrees })
}

export function lastSample(track: MountTrack): MountSample | undefined {
  return track.samples[track.samples.length - 1]
}

export function cover(track: MountTrack, to: EpochMs): MountTrack {
  return track.coveredUntil !== null && track.coveredUntil >= to ? track : { ...track, coveredUntil: to }
}

/** Appends a sample unless it repeats the last one, and drops what is older than `keepFrom` except the sample still holding at that time. */
export function appendSample(track: MountTrack, sample: MountSample, keepFrom: EpochMs): MountTrack {
  const last = lastSample(track)

  if (last && sameReading(last, sample)) return track

  if (last && sample.at < last.at) return track

  const samples = last && sample.at === last.at ? [...track.samples.slice(0, -1), sample] : [...track.samples, sample]
  const firstKept = samples.findLastIndex(candidate => candidate.at <= keepFrom)

  return { ...track, samples: firstKept > 0 ? samples.slice(firstKept) : samples }
}

export type TrackLookup =
  | { readonly kind: 'not-yet-covered' }
  | { readonly kind: 'no-sample' }
  | { readonly kind: 'stale' }
  | { readonly kind: 'held'; readonly sample: MountSample; readonly changes: readonly MountSample[] }

function lastAtOrBefore(samples: readonly MountSample[], time: EpochMs): number {
  let low = 0
  let high = samples.length - 1
  let found = -1

  while (low <= high) {
    const middle = (low + high) >> 1

    if ((samples[middle]?.at ?? Infinity) <= time) {
      found = middle
      low = middle + 1
    } else high = middle - 1
  }

  return found
}

/** What the mount read over an exposure: the sample holding at its start, and every sample that arrived before it ended. */
export function lookup(track: MountTrack, from: EpochMs, to: EpochMs): TrackLookup {
  if (track.coveredUntil === null || track.coveredUntil < to) return { kind: 'not-yet-covered' }

  const index = lastAtOrBefore(track.samples, from)
  const held = track.samples[index]

  if (held === undefined) return { kind: 'no-sample' }

  const changes = track.samples.slice(index + 1, lastAtOrBefore(track.samples, to) + 1)

  if (!held.fresh || changes.some(change => !change.fresh)) return { kind: 'stale' }

  return { kind: 'held', sample: held, changes }
}
