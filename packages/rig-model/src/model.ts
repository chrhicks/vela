import {
  epochMs,
  type AssessKind,
  type Draft,
  type Envelope,
  type EpochMs,
  type EventId,
  type FrameBody,
  type ImageId,
  type RigEvent,
  type RigId,
  type SolveBody,
  type SourceId,
} from '@vela/rig-events'
import type { Site } from '@vela/rig-sky'
import { believe, type Belief } from './belief.ts'
import { closeEpoch, forgetBefore, noEpochs, openEpoch, type Epochs } from './epochs.ts'
import { exposureOf, isPointingFrame, joinFix, type RejectReason } from './join.ts'
import {
  confidenceOf,
  lastFixOf,
  nextMount,
  type MountInput,
  type MountPosition,
  type PointingFix,
} from './mount-position.ts'
import { observeMount, type MountObservation } from './observation.ts'
import { appendSample, cover, emptyTrack, lastSample, separationDegrees, type MountSample, type MountTrack } from './track.ts'

export interface ModelConfig {
  readonly rig: RigId
  readonly source: SourceId
  readonly knownMaxAgeMs: number
  readonly streamQuietMs: number
  readonly joinExpiryMs: number
  readonly maxPending: number
  readonly keepMs: number
  readonly positionStepArcsec: number
  readonly hiddenMoveArcmin: number
  readonly maxFixes: number
}

export function defaultConfig(rig: RigId, source: SourceId): ModelConfig {
  return {
    rig,
    source,
    knownMaxAgeMs: 30 * 60_000,
    streamQuietMs: 10_000,
    joinExpiryMs: 120_000,
    maxPending: 64,
    keepMs: 2 * 3_600_000,
    positionStepArcsec: 30,
    hiddenMoveArcmin: 5,
    maxFixes: 2000,
  }
}

export interface ClockInput {
  readonly kind: 'clock'
  readonly at: EpochMs
}

export type ModelInput = RigEvent | ClockInput

export type Output = Draft<Envelope<AssessKind>>

interface Link {
  readonly instanceId: string | null
  readonly bindingId: string | null
  readonly lastSeenAt: EpochMs | null
  readonly operations: ReadonlyMap<string, 'active' | 'settled'>
}

interface Motion {
  readonly slewing: boolean
  readonly active: ReadonlySet<string>
  readonly uncertain: boolean
  readonly settleAt: EpochMs | null
}

interface Holds {
  readonly motion: boolean
  readonly gap: boolean
  readonly unavailable: boolean
}

interface PendingFrame {
  readonly id: EventId
  readonly body: FrameBody
  readonly endsAt: EpochMs
  readonly seenAt: EpochMs
}

interface PendingSolve {
  readonly id: EventId
  readonly body: SolveBody
  readonly at: EpochMs
  readonly seenAt: EpochMs
}

interface Pending {
  readonly frames: ReadonlyMap<ImageId, PendingFrame>
  readonly solves: ReadonlyMap<ImageId, PendingSolve>
}

export interface Counters {
  readonly inputs: number
  readonly fixes: number
  readonly historyOnly: number
  readonly rejected: Readonly<Partial<Record<RejectReason, number>>>
  readonly skippedFrames: number
}

export interface RigModel {
  readonly config: ModelConfig
  readonly now: EpochMs | null
  readonly session: { readonly setupId: string; readonly mode: 'observing' | 'indoors'; readonly since: EpochMs } | null
  readonly link: Link
  readonly site: Belief<Site | null, 'site'>
  readonly mount: Belief<MountPosition, 'setup'>
  readonly track: MountTrack
  readonly epochs: Epochs
  readonly holds: Holds
  readonly motion: Motion
  readonly pending: Pending
  readonly decided: ReadonlyMap<ImageId, EpochMs>
  readonly fixes: readonly PointingFix[]
  readonly counters: Counters
}

export function createModel(config: ModelConfig): RigModel {
  const origin = epochMs(0)

  return {
    config,
    now: null,
    session: null,
    link: { instanceId: null, bindingId: null, lastSeenAt: null, operations: new Map() },
    site: believe('site', null, 'none', origin, []),
    mount: believe('setup', { state: 'unknown', since: origin, reason: 'never-solved' }, 'none', origin, []),
    track: emptyTrack,
    epochs: noEpochs,
    holds: { motion: false, gap: false, unavailable: false },
    motion: { slewing: false, active: new Set(), uncertain: false, settleAt: null },
    pending: { frames: new Map(), solves: new Map() },
    decided: new Map(),
    fixes: [],
    counters: { inputs: 0, fixes: 0, historyOnly: 0, rejected: {}, skippedFrames: 0 },
  }
}

export interface StepResult {
  readonly model: RigModel
  readonly out: readonly Output[]
}

type Working = { -readonly [K in keyof RigModel]: RigModel[K] }

function reasonOf(position: MountPosition): string {
  switch (position.state) {
    case 'unknown':
    case 'uncertain':
      return position.reason
    case 'known':
      return 'solved'
    case 'moving':
      return 'moving'
  }
}

function summaryOf(fix: PointingFix) {
  return { imageId: fix.imageId, at: fix.at, epoch: fix.epoch, errorArcmin: fix.errorArcmin, timeTrust: fix.timeTrust }
}

function lastFixIdOf(position: MountPosition): ImageId | null {
  return (position.state === 'moving' ? lastFixOf(position.before) : lastFixOf(position))?.imageId ?? null
}

function stamp(w: Working, at: EpochMs) {
  return { rig: w.config.rig, source: w.config.source, at, seenAt: w.now !== null && w.now > at ? w.now : at }
}

function moveMount(w: Working, out: Output[], input: MountInput, evidence: readonly EventId[] = []) {
  const before = w.mount.value
  const after = nextMount(before, input)

  if (after === before) return

  w.mount = believe('setup', after, confidenceOf(after), input.at, [...w.mount.evidence, ...evidence])

  if (after.state === before.state && reasonOf(after) === reasonOf(before) && lastFixIdOf(after) === lastFixIdOf(before)) return

  const fix = after.state === 'moving' ? lastFixOf(after.before) : lastFixOf(after)

  out.push({
    ...stamp(w, input.at),
    kind: 'mount-position',
    body: { state: after.state, since: after.since, reason: reasonOf(after), lastFix: fix ? summaryOf(fix) : null },
  })
}

function breakEpoch(w: Working, at: EpochMs) {
  w.epochs = closeEpoch(w.epochs, at)
}

function reopenIfClear(w: Working, at: EpochMs) {
  if (w.link.instanceId !== null && !w.holds.motion && !w.holds.gap && !w.holds.unavailable) w.epochs = openEpoch(w.epochs, at)
}

function hold(w: Working, cause: keyof Holds, value: boolean) {
  w.holds = { ...w.holds, [cause]: value }
}

function openGap(w: Working, out: Output[], from: EpochMs, noticedAt: EpochMs) {
  if (w.holds.gap) return

  hold(w, 'gap', true)
  breakEpoch(w, from)
  moveMount(w, out, { t: 'continuity-lost', at: noticedAt, why: 'stream-gap' })
}

function startMotion(w: Working, out: Output[], at: EpochMs) {
  if (w.holds.motion) return

  hold(w, 'motion', true)
  breakEpoch(w, at)
  moveMount(w, out, { t: 'moved', at })
}

function endMotion(w: Working, out: Output[], how: 'confirmed' | 'uncertain') {
  const settleAt = w.motion.settleAt ?? w.now ?? epochMs(0)

  hold(w, 'motion', false)
  w.motion = { slewing: false, active: new Set(), uncertain: false, settleAt: null }
  moveMount(w, out, { t: 'settled', at: settleAt, how })
  reopenIfClear(w, settleAt)
}

function endMotionIfDone(w: Working, out: Output[]) {
  if (w.holds.motion && !w.motion.slewing && w.motion.active.size === 0) endMotion(w, out, w.motion.uncertain ? 'uncertain' : 'confirmed')
}

function sampleOf(observation: MountObservation, previous: MountSample | undefined): MountSample | null {
  const { position } = observation

  if (position === null) return null

  return {
    at: epochMs(Math.max(position.at, observation.slewing?.at ?? 0)),
    raHours: position.raHours,
    decDegrees: position.decDegrees,
    frame: position.frame,
    slewing: observation.slewing?.value ?? false,
    tracking: observation.tracking ?? previous?.tracking ?? true,
    pierSide: observation.pierSide,
    fresh: position.fresh,
  }
}

function followMotion(w: Working, out: Output[], observation: MountObservation, coveredBefore: EpochMs | null) {
  const { slewing } = observation
  let { active, uncertain, settleAt } = w.motion
  let isSlewing = w.motion.slewing
  const operations = new Map(w.link.operations)
  const noteSettle = (at: EpochMs) => (settleAt = settleAt === null || at > settleAt ? at : settleAt)

  if (slewing?.value === true && !isSlewing) {
    isSlewing = true
    startMotion(w, out, slewing.at)
  } else if (slewing?.value === false && isSlewing) {
    isSlewing = false
    noteSettle(slewing.at)
  }

  for (const operation of observation.operations) {
    const known = operations.get(operation.id)
    const happenedBefore = known === undefined && operation.phase === 'settled' && (coveredBefore === null || (operation.settledAt ?? 0) <= coveredBefore)

    if (happenedBefore) {
      operations.set(operation.id, 'settled')
      continue
    }

    if (operation.phase === 'active' && known === undefined) {
      operations.set(operation.id, 'active')
      active = new Set(active).add(operation.id)
      startMotion(w, out, operation.startedAt)
    }

    if (operation.phase === 'settled' && known !== 'settled') {
      if (known === undefined) startMotion(w, out, operation.startedAt)

      operations.set(operation.id, 'settled')
      active = new Set([...active].filter(id => id !== operation.id))
      uncertain ||= !operation.confirmed
      noteSettle(operation.settledAt ?? observation.at)
    }
  }

  const present = new Set(observation.operations.map(operation => operation.id))

  for (const id of operations.keys()) if (!present.has(id)) operations.delete(id)

  w.motion = { slewing: isSlewing, active, uncertain, settleAt }
  w.link = { ...w.link, operations }
  endMotionIfDone(w, out)
}

function onRestart(w: Working, out: Output[], at: EpochMs) {
  breakEpoch(w, w.track.coveredUntil ?? at)
  w.link = { ...w.link, operations: new Map() }

  if (w.holds.motion) endMotion(w, out, 'uncertain')

  moveMount(w, out, { t: 'power-cycled', at })
}

/** A snapshot with no mount still tells us Cria restarted, and what the mount did before it is no longer known. */
function onStateWithoutMount(w: Working, out: Output[], event: Envelope<'cria.state'>) {
  const { state } = event.body
  const { instanceId } = w.link

  if (instanceId === null || instanceId === state.instanceId) return

  w.link = { ...w.link, instanceId: state.instanceId, lastSeenAt: event.seenAt }
  onRestart(w, out, epochMs(state.generatedAt))
}

function onState(w: Working, out: Output[], event: Envelope<'cria.state'>) {
  const observation = observeMount(event.body.state)

  if (observation === null) return onStateWithoutMount(w, out, event)

  const { at } = observation
  const link = w.link
  const restarted = link.instanceId !== null && (link.instanceId !== observation.instanceId || link.bindingId !== observation.bindingId)

  w.link = { ...link, instanceId: observation.instanceId, bindingId: observation.bindingId, lastSeenAt: event.seenAt }

  if (observation.site && JSON.stringify(observation.site) !== JSON.stringify(w.site.value))
    w.site = believe('site', observation.site, 'high', at, [event.id])

  if (restarted) onRestart(w, out, at)

  if (observation.lost) {
    if (!w.holds.unavailable) {
      hold(w, 'unavailable', true)
      breakEpoch(w, w.track.coveredUntil ?? at)
      moveMount(w, out, { t: 'continuity-lost', at, why: 'mount-unavailable' })
    }

    return
  }

  hold(w, 'unavailable', false)
  hold(w, 'gap', false)

  const previous = lastSample(w.track)
  const sample = sampleOf(observation, previous)

  if (sample) {
    const hidden =
      previous !== undefined &&
      !restarted &&
      !w.holds.motion &&
      !previous.slewing &&
      !sample.slewing &&
      previous.frame === sample.frame &&
      separationDegrees(previous, sample) * 60 > w.config.hiddenMoveArcmin

    if (hidden) {
      startMotion(w, out, w.track.coveredUntil ?? at)
      w.motion = { ...w.motion, settleAt: sample.at }
      endMotion(w, out, 'confirmed')
    }

    w.track = appendSample(w.track, sample, epochMs(at - w.config.keepMs))
  }

  const coveredBefore = w.track.coveredUntil

  w.track = cover(w.track, at)
  followMotion(w, out, observation, coveredBefore)
  reopenIfClear(w, at)

  if (w.epochs.list.length > 8) w.epochs = forgetBefore(w.epochs, epochMs(at - w.config.keepMs))
}

function note(w: Working, field: 'fixes' | 'historyOnly' | 'skippedFrames') {
  w.counters = { ...w.counters, [field]: w.counters[field] + 1 }
}

function reject(w: Working, out: Output[], imageId: ImageId, at: EpochMs, reason: RejectReason) {
  w.counters = { ...w.counters, rejected: { ...w.counters.rejected, [reason]: (w.counters.rejected[reason] ?? 0) + 1 } }
  out.push({ ...stamp(w, at), kind: 'pointing-fix', body: { outcome: 'rejected', imageId, reason } })
}

function settle(w: Working, imageId: ImageId, at: EpochMs) {
  const frames = new Map(w.pending.frames)
  const solves = new Map(w.pending.solves)

  frames.delete(imageId)
  solves.delete(imageId)
  w.pending = { frames, solves }
  w.decided = new Map(w.decided).set(imageId, at)
}

function decide(w: Working, out: Output[], imageId: ImageId) {
  const frame = w.pending.frames.get(imageId)

  if (frame === undefined) return

  const solve = w.pending.solves.get(imageId)
  const joinedAt = solve === undefined ? frame.seenAt : epochMs(Math.max(frame.seenAt, solve.seenAt))

  if (solve !== undefined && joinedAt >= frame.endsAt + w.config.joinExpiryMs) {
    settle(w, imageId, frame.endsAt)

    return reject(w, out, imageId, frame.endsAt, solve.seenAt >= frame.seenAt ? 'solve-missing' : 'frame-missing')
  }

  const outcome = joinFix({
    frame: frame.body,
    solve: solve?.body,
    track: w.track,
    epochs: w.epochs,
    site: w.site.value,
    joinedAt: epochMs(Math.max(joinedAt, w.now ?? joinedAt)),
    knownMaxAgeMs: w.config.knownMaxAgeMs,
    positionStepDegrees: w.config.positionStepArcsec / 3600,
  })

  if (outcome.kind === 'pending') return

  settle(w, imageId, frame.endsAt)

  if (outcome.kind === 'rejected') return reject(w, out, imageId, frame.endsAt, outcome.reason)

  const { fix, effect } = outcome

  w.fixes = [...w.fixes, fix].slice(-w.config.maxFixes)
  note(w, 'fixes')
  out.push({ ...stamp(w, fix.at), kind: 'pointing-fix', body: { outcome: 'fix', fix: summaryOf(fix), effect } })

  if (effect.kind === 'history-only') return note(w, 'historyOnly')

  moveMount(w, out, { t: 'fix', at: fix.at, fix }, solve ? [frame.id, solve.id] : [frame.id])
}

function onFrame(w: Working, out: Output[], event: Envelope<'frame'>) {
  const image = event.body.image

  if (image === null || !isPointingFrame(event.body) || w.session?.mode === 'indoors' || w.decided.has(image.id)) return note(w, 'skippedFrames')

  const endsAt = exposureOf(event.body)?.to ?? event.at
  const frames = new Map(w.pending.frames).set(image.id, { id: event.id, body: event.body, endsAt, seenAt: event.seenAt })

  w.pending = { ...w.pending, frames }

  if (frames.size > w.config.maxPending) {
    const oldest = frames.keys().next().value

    if (oldest !== undefined) {
      const dropped = frames.get(oldest)
      settle(w, oldest, dropped?.endsAt ?? event.at)
      reject(w, out, oldest, dropped?.endsAt ?? event.at, 'mount-not-covered')
    }
  }

}

function onSolve(w: Working, out: Output[], event: Envelope<'solve'>) {
  const imageId = event.body.imageId

  if (w.decided.has(imageId) || w.session?.mode === 'indoors') return

  w.pending = { ...w.pending, solves: new Map(w.pending.solves).set(imageId, { id: event.id, body: event.body, at: event.at, seenAt: event.seenAt }) }
}

function onSession(w: Working, out: Output[], event: Envelope<'session'>) {
  const { body } = event

  if (body.phase === 'ended') {
    w.session = null

    return
  }

  w.session = { setupId: body.setupId, mode: body.mode, since: event.at }
  w.fixes = []
  w.decided = new Map()
  w.pending = { frames: new Map(), solves: new Map() }
  breakEpoch(w, event.at)
  moveMount(w, out, { t: 'session-start', at: event.at })
  reopenIfClear(w, event.at)
}

type Deadline = { readonly at: EpochMs; readonly fire: () => void }

function deadlines(w: Working, out: Output[]): Deadline[] {
  const found: Deadline[] = []
  const position = w.mount.value

  if (position.state === 'known') {
    const { fix } = position
    found.push({ at: epochMs(fix.at + w.config.knownMaxAgeMs), fire: () => moveMount(w, out, { t: 'expired', at: epochMs(fix.at + w.config.knownMaxAgeMs) }) })
  }

  if (w.link.lastSeenAt !== null && !w.holds.gap) {
    const quietAt = epochMs(w.link.lastSeenAt + w.config.streamQuietMs)
    found.push({ at: quietAt, fire: () => openGap(w, out, w.track.coveredUntil ?? quietAt, quietAt) })
  }

  for (const [imageId, frame] of w.pending.frames) {
    const expiresAt = epochMs(frame.endsAt + w.config.joinExpiryMs)
    const reason: RejectReason = w.pending.solves.has(imageId) ? 'mount-not-covered' : 'solve-missing'

    found.push({
      at: expiresAt,
      fire: () => {
        settle(w, imageId, frame.endsAt)
        reject(w, out, imageId, frame.endsAt, reason)
      },
    })
  }

  for (const [imageId, solve] of w.pending.solves) {
    if (w.pending.frames.has(imageId)) continue

    found.push({
      at: epochMs(solve.at + w.config.joinExpiryMs),
      fire: () => {
        settle(w, imageId, solve.at)
        reject(w, out, imageId, solve.at, 'frame-missing')
      },
    })
  }

  return found
}

function advance(w: Working, out: Output[], to: EpochMs) {
  if (w.now !== null && to <= w.now) return

  for (;;) {
    const due = deadlines(w, out)
      .filter(deadline => deadline.at <= to)
      .reduce<Deadline | undefined>((earliest, deadline) => (earliest === undefined || deadline.at < earliest.at ? deadline : earliest), undefined)

    if (due === undefined) break

    w.now = w.now !== null && w.now > due.at ? w.now : due.at
    due.fire()
  }

  w.now = to
}

function handle(w: Working, out: Output[], event: RigEvent) {
  switch (event.kind) {
    case 'cria.state':
      return onState(w, out, event)
    case 'cria.stream':
      if (event.body.event === 'ended') openGap(w, out, event.at, event.at)

      return
    case 'gap':
      openGap(w, out, event.body.from, event.at)

      if (event.body.to !== null) {
        hold(w, 'gap', false)
        reopenIfClear(w, event.body.to)
      }

      return
    case 'session':
      return onSession(w, out, event)
    case 'frame':
      return onFrame(w, out, event)
    case 'solve':
      return onSolve(w, out, event)
    case 'cria.exchange':
    case 'cria.image':
    case 'mount-position':
    case 'pointing-fix':
      return
  }
}

function advancesTime(input: ModelInput): input is ClockInput | Envelope<'cria.state' | 'cria.stream' | 'gap' | 'session'> {
  return input.kind === 'clock' || input.kind === 'cria.state' || input.kind === 'cria.stream' || input.kind === 'gap' || input.kind === 'session'
}

/**
 * (model, input) -> (model, out). The only way the model changes, and it never reads a clock.
 *
 * Time advances on the Cria stream and on clock inputs, and on nothing else. Before an input is applied, every deadline up to its time fires, each stamped at the moment it fell due,
 * so the same events give the same output whether clock inputs came every second or never.
 *
 * `out` holds drafts only. The shell stamps ids and publishes or archives them; the model cannot.
 */
export function step(model: RigModel, input: ModelInput): StepResult {
  const w: Working = { ...model, counters: { ...model.counters, inputs: model.counters.inputs + 1 } }
  const out: Output[] = []

  if (advancesTime(input)) advance(w, out, input.kind === 'clock' ? input.at : input.seenAt)

  if (input.kind !== 'clock') handle(w, out, input)

  for (const imageId of w.pending.frames.keys()) decide(w, out, imageId)

  return { model: w, out }
}
