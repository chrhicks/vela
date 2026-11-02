import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Schema } from 'effect'
import { FrameBody, ImageId, RigEventSchema, type EpochMs } from '@vela/rig-events'
import { readJsonl, reasonOf, type SourceProblem } from './jsonl.ts'
import type { CapturedAtSource, FrameType } from './saved-images.ts'
import { instantOf } from './times.ts'

export type FrameOutcome = typeof FrameBody.Type.outcome

/** One line of Vela's old `frames.jsonl`, as the writer deleted in plan step 13a wrote it. */
const OldLine = Schema.Struct({
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
  message: Schema.optionalKey(FrameBody.fields.message),
  provenance: Schema.optionalKey(FrameBody.fields.provenance),
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

/** A line is an old record or a run-log envelope (`docs/run-log.md`); its own shape says which. */
const Line = Schema.Union([OldLine, RigEventSchema])

/**
 * An envelope is canonical JSON, so it starts with its `at` key. Every kind but `frame` is skipped unparsed:
 * a run log is mostly `cria.state` lines of about 40 KB, and a night holds tens of thousands of them.
 */
const isOtherEvent = (text: string) => text.startsWith('{"at":') && !text.includes('"kind":"frame"')

type Settled = Omit<typeof OldLine.Type, 'version'>

function settledOf(value: typeof Line.Type): { readonly settled: Settled; readonly eventId: string | null } | undefined {
  if ('version' in value) return { settled: value, eventId: null }

  return value.kind === 'frame' ? { settled: { ...value.body, rigId: value.rig }, eventId: value.id } : undefined
}

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
  /** Why the attempt did not end well; null for `saved` and `unsaved`, and for lines written before the field. */
  readonly message: string | null
  readonly provenance: typeof FrameBody.Type.provenance
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

/** An old `frames.jsonl` is one file. A run log is a directory of `run-*.jsonl` files, which sort in time order. */
export async function runLogFiles(path: string): Promise<readonly string[]> {
  if (!(await stat(path)).isDirectory()) return [path]

  return (await readdir(path)).filter(name => /^run-.+\.jsonl$/.test(name)).toSorted().map(name => join(path, name))
}

/**
 * Reads the settled exposure attempts from old `frames.jsonl` files and from run logs, one record per attempt, and
 * writes nothing. Each path is a file or a run-log directory, and each line says which format it is. A `frame` event
 * the log wrote twice after a failed write is kept once.
 */
export async function readFrameRecords(paths: readonly string[]): Promise<FrameRecords> {
  const records: FrameRecord[] = []
  const problems: SourceProblem[] = []
  const seen = new Set<string>()
  let incompleteTail = false

  for (const path of paths) {
    let files: readonly string[]

    try {
      files = await runLogFiles(path)
    } catch (error) {
      problems.push({ path, line: null, reason: reasonOf(error) })
      continue
    }

    for (const [index, file] of files.entries()) {
      const read = await readJsonl(file, Line, isOtherEvent)

      problems.push(...read.problems)
      incompleteTail ||= read.incompleteTail && index === files.length - 1

      for (const { line, value } of read.rows) {
        const found = settledOf(value)

        if (found === undefined || (found.eventId !== null && seen.has(found.eventId))) continue

        if (found.eventId !== null) seen.add(found.eventId)
        const { settled } = found
        const startedAt = instantOf(settled.startedAt)
        const settledAt = instantOf(settled.settledAt)
        const captured = settled.image === null ? null : instantOf(settled.image.capturedAt)
        const received = settled.image === null ? null : instantOf(settled.image.receivedAt)

        if (startedAt === undefined || settledAt === undefined || captured === undefined || received === undefined) {
          problems.push({ path: file, line, reason: 'a timestamp is not an instant' })
          continue
        }

        records.push({
          line,
          rigId: settled.rigId,
          runId: settled.runId,
          attempt: settled.attempt,
          startedAt,
          settledAt,
          exposureSeconds: settled.exposureSeconds,
          frameType: settled.frameType ?? 'light',
          subject: settled.subject ?? null,
          outcome: settled.outcome,
          message: settled.message ?? null,
          provenance: settled.provenance ?? null,
          image:
            settled.image === null || captured === null || received === null
              ? null
              : { id: settled.image.id, capturedAt: captured, capturedAtSource: settled.image.capturedAtSource, receivedAt: received, width: settled.image.width, height: settled.image.height },
          statistics: settled.statistics ?? null,
        })
      }
    }
  }

  return { records, problems, incompleteTail }
}
