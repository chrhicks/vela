import { epochMs, rigId, seal, sourceId, type ImageId, type RigEvent, type SkyPosition } from '@vela/rig-events'
import { mountState, type StateOptions } from './state.ts'

export const testRig = rigId('test-rig')

export const testSource = sourceId('test:scenario')

const stamp = (at: number, seenAt: number) => ({ rig: testRig, source: testSource, at: epochMs(at), seenAt: epochMs(seenAt) })

export interface SnapshotOptions extends Omit<StateOptions, 'sequence'> {
  readonly at: number
  readonly sequence?: number
  readonly seenAfterMs?: number
}

let counter = 0

export function snapshot(options: SnapshotOptions): RigEvent {
  const sequence = options.sequence ?? ++counter

  return seal({
    ...stamp(options.at, options.at + (options.seenAfterMs ?? 20)),
    kind: 'cria.state',
    body: { origin: 'http://cria.test', freshness: 'observed', state: mountState({ ...options, sequence, generatedAt: options.at }) },
  })
}

export interface SteadyOptions extends Omit<SnapshotOptions, 'at'> {
  readonly from: number
  readonly to: number
  readonly everyMs?: number
}

export function steady(options: SteadyOptions): RigEvent[] {
  const { from, to, everyMs = 1000, ...rest } = options
  const events: RigEvent[] = []

  for (let at = from; at <= to; at += everyMs) events.push(snapshot({ ...rest, at, mount: { ...rest.mount, at } }))

  return events
}

export interface FrameOptions {
  readonly image: ImageId
  readonly capturedAt: number
  readonly exposureSeconds: number
  readonly seenAt: number
  readonly source?: 'camera' | 'server-estimate'
  readonly frameType?: 'light' | 'dark'
}

export function frame(options: FrameOptions): RigEvent {
  return seal({
    ...stamp(options.capturedAt, options.seenAt),
    kind: 'frame',
    body: {
      runId: 'run-1',
      attempt: 1,
      startedAt: new Date(options.capturedAt).toISOString(),
      settledAt: new Date(options.capturedAt + options.exposureSeconds * 1000).toISOString(),
      exposureSeconds: options.exposureSeconds,
      frameType: options.frameType ?? 'light',
      subject: null,
      outcome: 'saved',
      image: {
        id: options.image,
        capturedAt: new Date(options.capturedAt).toISOString(),
        capturedAtSource: options.source ?? 'camera',
        receivedAt: new Date(options.seenAt).toISOString(),
        width: 6248,
        height: 4176,
        ref: null,
      },
      statistics: null,
      origin: 'capture-run',
    },
  })
}

export function solved(image: ImageId, centre: SkyPosition, seenAt: number): RigEvent {
  return seal({
    ...stamp(seenAt, seenAt),
    kind: 'solve',
    body: {
      status: 'solved',
      imageId: image,
      solverVersion: 'astap-test',
      solveMs: 800,
      hint: null,
      centre,
      wcs: { width: 6248, height: 4176, referenceX: 3124.5, referenceY: 2088.5, ...centre, cd: [-0.0003, 0, 0, 0.0003] },
    },
  })
}

export function unsolved(image: ImageId, seenAt: number): RigEvent {
  return seal({ ...stamp(seenAt, seenAt), kind: 'solve', body: { status: 'no-solution', imageId: image, solverVersion: 'astap-test', solveMs: 5000, hint: null, reason: 'no-match' } })
}

export function session(at: number, phase: 'started' | 'ended' = 'started', mode: 'observing' | 'indoors' = 'observing'): RigEvent {
  return seal({ ...stamp(at, at), kind: 'session', body: { phase, setupId: 'setup-1', mode, note: null } })
}

export function streamEnded(at: number): RigEvent {
  return seal({ ...stamp(at, at), kind: 'cria.stream', body: { origin: 'http://cria.test', event: 'ended', message: 'closed' } })
}

export function gap(from: number, to: number | null, seenAt: number): RigEvent {
  return seal({
    ...stamp(seenAt, seenAt),
    kind: 'gap',
    body: { source: testSource, from: epochMs(from), to: to === null ? null : epochMs(to), reason: 'dropped', dropped: 12 },
  })
}

export function inOrder(...groups: readonly (RigEvent | readonly RigEvent[])[]): RigEvent[] {
  return groups.flat().map((event, index) => ({ event, index })).sort((a, b) => a.event.seenAt - b.event.seenAt || a.index - b.index).map(item => item.event)
}
