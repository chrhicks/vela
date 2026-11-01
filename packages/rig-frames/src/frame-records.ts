import { Schema } from 'effect'
import { FrameBody, ImageId, type EpochMs } from '@vela/rig-events'
import { readJsonl, type SourceProblem } from './jsonl.ts'
import type { CapturedAtSource, FrameType } from './saved-images.ts'
import { instantOf } from './times.ts'

export type FrameOutcome = typeof FrameBody.Type.outcome

/** One line of Vela's `frames.jsonl`, as `apps/server/src/capture/frame-records.ts` writes it. */
const Line = Schema.Struct({
  version: Schema.Literal(1),
  rigId: Schema.String,
  runId: Schema.String,
  attempt: Schema.Int,
  startedAt: Schema.String,
  settledAt: Schema.String,
  exposureSeconds: Schema.Number,
  frameType: Schema.optionalKey(FrameBody.fields.frameType),
  subject: Schema.optionalKey(FrameBody.fields.subject),
  outcome: FrameBody.fields.outcome,
  image: Schema.NullOr(
    Schema.Struct({
      id: ImageId,
      capturedAt: Schema.String,
      capturedAtSource: Schema.Literals(['camera', 'server-estimate']),
      receivedAt: Schema.String,
      width: Schema.Int,
      height: Schema.Int,
    }),
  ),
  statistics: Schema.optionalKey(FrameBody.fields.statistics),
})

export interface FrameRecord {
  readonly line: number
  readonly rigId: string
  readonly runId: string
  readonly attempt: number
  readonly startedAt: EpochMs
  readonly settledAt: EpochMs
  readonly exposureSeconds: number
  readonly frameType: FrameType
  readonly subject: typeof FrameBody.Type.subject
  readonly outcome: FrameOutcome
  readonly image: {
    readonly id: typeof ImageId.Type
    readonly capturedAt: EpochMs
    readonly capturedAtSource: CapturedAtSource
    readonly receivedAt: EpochMs
    readonly width: number
    readonly height: number
  } | null
  readonly statistics: typeof FrameBody.Type.statistics
}

export interface FrameRecords {
  readonly records: readonly FrameRecord[]
  readonly problems: readonly SourceProblem[]
  readonly incompleteTail: boolean
}

/** Reads `frames.jsonl`, one record per settled exposure attempt, and writes nothing. */
export async function readFrameRecords(path: string): Promise<FrameRecords> {
  const read = await readJsonl(path, Line)
  const records: FrameRecord[] = []
  const problems = [...read.problems]

  for (const { line, value } of read.rows) {
    const startedAt = instantOf(value.startedAt)
    const settledAt = instantOf(value.settledAt)
    const captured = value.image === null ? null : instantOf(value.image.capturedAt)
    const received = value.image === null ? null : instantOf(value.image.receivedAt)

    if (startedAt === undefined || settledAt === undefined || captured === undefined || received === undefined) {
      problems.push({ path, line, reason: 'a timestamp is not an instant' })
      continue
    }

    records.push({
      line,
      rigId: value.rigId,
      runId: value.runId,
      attempt: value.attempt,
      startedAt,
      settledAt,
      exposureSeconds: value.exposureSeconds,
      frameType: value.frameType ?? 'light',
      subject: value.subject ?? null,
      outcome: value.outcome,
      image: value.image === null || captured === null || received === null ? null : { ...value.image, capturedAt: captured, receivedAt: received },
      statistics: value.statistics ?? null,
    })
  }

  return { records, problems, incompleteTail: read.incompleteTail }
}
