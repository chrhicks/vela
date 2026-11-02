import { epochMs, rigId, seal, sourceId, type EpochMs, type ImageId, type PointingFixBody, type RigEvent, type SolveBody } from '@vela/rig-events'
import { frameDraft, type FrameRecord, type SavedImage } from '@vela/rig-frames'
import { createModel, defaultConfig, exposureOf, step, type ModelInput, type RigModel } from '@vela/rig-model'

const source = sourceId('import:backfill')

/** A saved image and the record Vela wrote for its attempt, if it wrote one (it began on 2026-10-19). */
export interface Capture {
  readonly image: SavedImage
  readonly record: FrameRecord | undefined
}

export interface Solved {
  readonly capture: Capture
  readonly body: SolveBody
}

function recordOf(image: SavedImage): FrameRecord {
  return {
    line: 0,
    rigId: image.rigId,
    runId: 'unrecorded',
    attempt: 0,
    startedAt: image.capturedAt,
    settledAt: image.receivedAt,
    exposureSeconds: image.exposureSeconds,
    frameType: image.frameType,
    subject: null,
    outcome: 'saved',
    image: { id: image.id, capturedAt: image.capturedAt, capturedAtSource: image.capturedAtSource ?? 'server-estimate', receivedAt: image.receivedAt, width: image.width, height: image.height },
    statistics: null,
  }
}

/**
 * The frame and solve facts a live stream would have delivered, with the times they would have arrived: the
 * frame when its exposure ends, the solve when the solver finished, `solveMs` later. Stamping them with the
 * time of the import instead makes the model reject every pair as `solve-missing`.
 */
export function arrivals(solved: Solved) {
  const { image, record } = solved.capture
  const draft = frameDraft(record ?? recordOf(image), image, rigId(image.rigId), source)
  const frameSeenAt = epochMs(image.capturedAt + image.exposureSeconds * 1000)
  const solveSeenAt = epochMs(frameSeenAt + solved.body.solveMs)

  return {
    frame: seal({ ...draft, seenAt: frameSeenAt, body: { ...draft.body, origin: record === undefined ? 'import' : 'capture-run' } }),
    solve: seal({ rig: rigId(image.rigId), source, kind: 'solve', at: solveSeenAt, seenAt: solveSeenAt, body: solved.body }),
  }
}

export type Join = PointingFixBody | { readonly outcome: 'undecided' }

export interface FrameRow {
  readonly imageId: ImageId
  readonly capturedAt: EpochMs
  readonly exposureSeconds: number
  readonly midpoint: EpochMs
  readonly solve: 'solved' | Extract<SolveBody, { readonly status: 'no-solution' }>['reason']
  readonly join: Join
}

/**
 * Feeds one night to the pure model: the mount's snapshots as they arrive, and between them every frame and solve
 * whose arrival time has come. When the mount stream ends, a clock input `settleMs` later lets the model give up on
 * any pair still waiting. Rows come back in capture order.
 */
export async function replayNight(options: {
  readonly solved: readonly Solved[]
  readonly mount: AsyncIterable<RigEvent>
  readonly settleMs: number
}): Promise<{ readonly rows: readonly FrameRow[]; readonly model: RigModel; readonly mountEvents: number }> {
  const config = defaultConfig(rigId('backfill'), sourceId('model:backfill'))
  const frames = options.solved.map(solved => ({ solved, ...arrivals(solved) })).toSorted((a, b) => a.solved.capture.image.capturedAt - b.solved.capture.image.capturedAt)
  const waiting = frames.flatMap(({ frame, solve }) => [frame, solve]).toSorted((a, b) => a.seenAt - b.seenAt)
  const decisions = new Map<ImageId, PointingFixBody>()
  let model = createModel(config)
  let next = 0
  let mountEvents = 0

  const feed = (input: ModelInput) => {
    const result = step(model, input)

    model = result.model

    for (const draft of result.out) if (draft.kind === 'pointing-fix') decisions.set(draft.body.outcome === 'fix' ? draft.body.fix.imageId : draft.body.imageId, draft.body)
  }

  const feedArrivedBy = (time: EpochMs) => {
    while (waiting[next] !== undefined && waiting[next]!.seenAt <= time) feed(waiting[next++]!)
  }

  for await (const event of options.mount) {
    mountEvents++
    feedArrivedBy(event.seenAt)
    feed(event)
  }

  feedArrivedBy(epochMs(waiting[waiting.length - 1]?.seenAt ?? 0))
  feed({ kind: 'clock', at: epochMs(Math.max(waiting[waiting.length - 1]?.seenAt ?? 0, model.now ?? 0) + options.settleMs) })

  const rows = frames.map(({ solved, frame }): FrameRow => {
    const { image } = solved.capture

    return {
      imageId: image.id,
      capturedAt: image.capturedAt,
      exposureSeconds: image.exposureSeconds,
      midpoint: frame.kind === 'frame' ? (exposureOf(frame.body)?.midpoint ?? image.capturedAt) : image.capturedAt,
      solve: solved.body.status === 'solved' ? 'solved' : solved.body.reason,
      join: decisions.get(image.id) ?? { outcome: 'undecided' },
    }
  })

  return { rows, model, mountEvents }
}
