import type { EpochMs, ImageId, SkyPosition } from '@vela/rig-events'
import type { Confidence } from './belief.ts'

export interface Interval {
  readonly from: EpochMs
  readonly to: EpochMs
}

export type PierSide = 'east' | 'west' | 'unknown'

/** One plate solve of one exposure, set against where the mount said it pointed at the exposure's midpoint. */
export interface PointingFix {
  readonly imageId: ImageId
  readonly exposure: Interval
  readonly at: EpochMs
  readonly epoch: number
  readonly errorArcmin: { readonly east: number; readonly north: number; readonly total: number }
  readonly timeTrust: 'camera' | 'server-estimate'
  readonly pierSide: PierSide
  readonly reportedJ2000: SkyPosition
  readonly solvedJ2000: SkyPosition
}

export type UnknownReason = 'never-solved' | 'session-start' | 'power-cycled'

export type UncertainReason = 'moved-without-solve' | 'operation-uncertain' | 'stream-gap' | 'instance-changed' | 'mount-unavailable' | 'stale'

export type ContinuityLoss = 'stream-gap' | 'instance-changed' | 'mount-unavailable'

export type Resting =
  | { readonly state: 'unknown'; readonly since: EpochMs; readonly reason: UnknownReason }
  | { readonly state: 'known'; readonly since: EpochMs; readonly fix: PointingFix }
  | { readonly state: 'uncertain'; readonly since: EpochMs; readonly reason: UncertainReason; readonly lastFix: PointingFix | null }

export type MountPosition = Resting | { readonly state: 'moving'; readonly since: EpochMs; readonly before: Resting }

export type MountInput =
  | { readonly t: 'moved'; readonly at: EpochMs }
  | { readonly t: 'settled'; readonly at: EpochMs; readonly how: 'confirmed' | 'uncertain' }
  | { readonly t: 'continuity-lost'; readonly at: EpochMs; readonly why: ContinuityLoss }
  | { readonly t: 'fix'; readonly at: EpochMs; readonly fix: PointingFix }
  | { readonly t: 'expired'; readonly at: EpochMs }
  | { readonly t: 'session-start'; readonly at: EpochMs }
  | { readonly t: 'power-cycled'; readonly at: EpochMs }

export type MountState = MountPosition['state']

export type MountInputKind = MountInput['t']

export function lastFixOf(position: Resting): PointingFix | null {
  switch (position.state) {
    case 'known':
      return position.fix
    case 'uncertain':
      return position.lastFix
    case 'unknown':
      return null
  }
}

function degrade(resting: Resting, why: UncertainReason, at: EpochMs): Resting {
  return resting.state === 'known' ? { state: 'uncertain', since: at, reason: why, lastFix: resting.fix } : resting
}

function afterMove(before: Resting, how: 'confirmed' | 'uncertain', at: EpochMs): Resting {
  if (before.state === 'unknown') return before

  return { state: 'uncertain', since: at, reason: how === 'confirmed' ? 'moved-without-solve' : 'operation-uncertain', lastFix: lastFixOf(before) }
}

function restart(input: Extract<MountInput, { t: 'session-start' | 'power-cycled' }>): Resting {
  return { state: 'unknown', since: input.at, reason: input.t === 'session-start' ? 'session-start' : 'power-cycled' }
}

function newer(current: PointingFix | null, offered: PointingFix): boolean {
  return current === null || offered.at >= current.at
}

/**
 * The transition table. Rows are the state a mount rests in, columns are what happened. A cell is a state.
 *
 *                  moved        settled               continuity-lost       fix                    expired
 *   unknown        moving       unknown               unknown               known                  unknown
 *   known          moving       known                 uncertain(why)        known (if not older)   uncertain(stale)
 *   moving         moving       before: unknown ->    moving, before        moving                 moving
 *                               unknown, else         degraded
 *                               uncertain
 *   uncertain      moving       uncertain             uncertain             known (if not older)   uncertain
 *
 * session-start and power-cycled go to unknown from every row. A fix reaches this table only after the
 * reducer has checked that its exposure sits inside the current motion epoch, so the table never decides
 * eligibility.
 */
export function nextMount(position: MountPosition, input: MountInput): MountPosition {
  if (input.t === 'session-start' || input.t === 'power-cycled') return restart(input)

  switch (position.state) {
    case 'unknown':
      return fromUnknown(position, input)
    case 'known':
      return fromKnown(position, input)
    case 'moving':
      return fromMoving(position, input)
    case 'uncertain':
      return fromUncertain(position, input)
  }
}

type Remaining = Exclude<MountInput, { t: 'session-start' | 'power-cycled' }>

function fromUnknown(position: Extract<MountPosition, { state: 'unknown' }>, input: Remaining): MountPosition {
  switch (input.t) {
    case 'moved':
      return { state: 'moving', since: input.at, before: position }
    case 'fix':
      return { state: 'known', since: input.at, fix: input.fix }
    case 'settled':
    case 'continuity-lost':
    case 'expired':
      return position
  }
}

function fromKnown(position: Extract<MountPosition, { state: 'known' }>, input: Remaining): MountPosition {
  switch (input.t) {
    case 'moved':
      return { state: 'moving', since: input.at, before: position }
    case 'settled':
      return position
    case 'continuity-lost':
      return degrade(position, input.why, input.at)
    case 'fix':
      return newer(position.fix, input.fix) ? { state: 'known', since: input.at, fix: input.fix } : position
    case 'expired':
      return degrade(position, 'stale', input.at)
  }
}

function fromMoving(position: Extract<MountPosition, { state: 'moving' }>, input: Remaining): MountPosition {
  switch (input.t) {
    case 'moved':
    case 'fix':
    case 'expired':
      return position
    case 'settled':
      return afterMove(position.before, input.how, input.at)
    case 'continuity-lost':
      return { ...position, before: degrade(position.before, input.why, input.at) }
  }
}

function fromUncertain(position: Extract<MountPosition, { state: 'uncertain' }>, input: Remaining): MountPosition {
  switch (input.t) {
    case 'moved':
      return { state: 'moving', since: input.at, before: position }
    case 'fix':
      return newer(position.lastFix, input.fix) ? { state: 'known', since: input.at, fix: input.fix } : position
    case 'settled':
    case 'continuity-lost':
    case 'expired':
      return position
  }
}

export function confidenceOf(position: MountPosition): Confidence {
  switch (position.state) {
    case 'known':
      return 'high'
    case 'uncertain':
      return 'low'
    case 'unknown':
    case 'moving':
      return 'none'
  }
}
