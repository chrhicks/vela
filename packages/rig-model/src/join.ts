import { epochMs, type EpochMs, type FrameBody, type ImageId, type SolveBody } from '@vela/rig-events'
import { fromMount, tangentOffsetArcmin, type Site } from '@vela/rig-sky'
import { currentEpoch, epochContaining, type Epochs } from './epochs.ts'
import type { PointingFix } from './mount-position.ts'
import { lookup, separationDegrees, type MountTrack } from './track.ts'

export const rejectReasons = [
  'no-solution',
  'not-a-pointing-frame',
  'bad-capture-time',
  'no-mount-sample',
  'mount-sample-stale',
  'mount-moved-during-exposure',
  'exposure-spans-epochs',
  'no-site',
  'offset-undefined',
  'mount-not-covered',
  'solve-missing',
  'frame-missing',
] as const

export type RejectReason = (typeof rejectReasons)[number]

export type FixEffect =
  | { readonly kind: 'restores-known' }
  | { readonly kind: 'history-only'; readonly reason: 'older-epoch' | 'server-estimate' | 'expired' }

export type JoinOutcome =
  | { readonly kind: 'pending' }
  | { readonly kind: 'rejected'; readonly reason: RejectReason }
  | { readonly kind: 'fix'; readonly fix: PointingFix; readonly effect: FixEffect }

export interface Exposure {
  readonly from: EpochMs
  readonly to: EpochMs
  readonly midpoint: EpochMs
}

/** Lights that left an image. */
export function isPointingFrame(frame: FrameBody): boolean {
  return frame.image !== null && frame.frameType === 'light' && frame.origin !== 'autofocus'
}

/** The exposure runs from `capturedAt` for `exposureSeconds`, and its midpoint is where the mount's position is read. */
export function exposureOf(frame: FrameBody): Exposure | null {
  const start = Date.parse(frame.image?.capturedAt ?? '')

  if (!Number.isFinite(start) || !(frame.exposureSeconds >= 0)) return null

  return { from: epochMs(start), to: epochMs(start + frame.exposureSeconds * 1000), midpoint: epochMs(start + frame.exposureSeconds * 500) }
}

export interface JoinInput {
  readonly frame: FrameBody
  readonly solve: SolveBody | undefined
  readonly track: MountTrack
  readonly epochs: Epochs
  readonly site: Site | null
  readonly joinedAt: EpochMs
  readonly knownMaxAgeMs: number
  readonly positionStepDegrees: number
}

function rejected(reason: RejectReason): JoinOutcome {
  return { kind: 'rejected', reason }
}

function effectOf(fix: PointingFix, epochs: Epochs, joinedAt: EpochMs, knownMaxAgeMs: number): FixEffect {
  if (fix.epoch !== currentEpoch(epochs)?.id) return { kind: 'history-only', reason: 'older-epoch' }

  if (fix.timeTrust !== 'camera') return { kind: 'history-only', reason: 'server-estimate' }

  return joinedAt - fix.at >= knownMaxAgeMs ? { kind: 'history-only', reason: 'expired' } : { kind: 'restores-known' }
}

/**
 * Sets one solve against the mount's track. The result depends only on the frame, its solve, the track, the
 * epochs and the site, so it does not matter in which order they arrived. Until the track vouches for the whole
 * exposure the answer is `pending`.
 *
 * A fix is the error of the mount's report: where the sky really was minus where the mount said it pointed, both
 * in J2000 at the exposure midpoint, on the tangent plane at the mount's position.
 */
export function joinFix(input: JoinInput): JoinOutcome {
  const { frame, solve, track, epochs, site } = input

  if (!isPointingFrame(frame)) return rejected('not-a-pointing-frame')

  if (solve === undefined) return { kind: 'pending' }

  if (solve.status === 'no-solution') return rejected('no-solution')

  const exposure = exposureOf(frame)

  if (exposure === null) return rejected('bad-capture-time')

  const held = lookup(track, exposure.from, exposure.to)

  switch (held.kind) {
    case 'not-yet-covered':
      return { kind: 'pending' }
    case 'no-sample':
      return rejected('no-mount-sample')
    case 'stale':
      return rejected('mount-sample-stale')
    case 'held':
      break
  }

  const moved =
    held.sample.slewing ||
    held.changes.some(change => change.slewing || separationDegrees(change, held.sample) > input.positionStepDegrees)

  if (moved) return rejected('mount-moved-during-exposure')

  const epoch = epochContaining(epochs, exposure.from, exposure.to)

  if (epoch === null) return rejected('exposure-spans-epochs')

  if (site === null) return rejected('no-site')

  const reading = [held.sample, ...held.changes].findLast(sample => sample.at <= exposure.midpoint) ?? held.sample
  const reportedJ2000 = fromMount({ raDegrees: reading.raHours * 15, decDegrees: reading.decDegrees }, reading.frame, new Date(exposure.midpoint), site)
  const error = tangentOffsetArcmin(reportedJ2000, solve.centre)

  if (error === null) return rejected('offset-undefined')

  const fix: PointingFix = {
    imageId: solve.imageId,
    exposure: { from: exposure.from, to: exposure.to },
    at: exposure.midpoint,
    epoch: epoch.id,
    errorArcmin: error,
    timeTrust: frame.image?.capturedAtSource ?? 'server-estimate',
    pierSide: reading.pierSide,
    reportedJ2000,
    solvedJ2000: solve.centre,
  }

  return { kind: 'fix', fix, effect: effectOf(fix, epochs, input.joinedAt, input.knownMaxAgeMs) }
}

export function imageOf(frame: FrameBody): ImageId | null {
  return frame.image?.id ?? null
}
