import { Schema } from 'effect'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { SkyPosition, type EpochMs } from '@vela/rig-events'
import { readJsonl, reasonOf, type SourceProblem } from './jsonl.ts'
import type { CapturedAtSource } from './saved-images.ts'
import { instantOf } from './times.ts'

const Position = SkyPosition

const Polar = Schema.Struct({ altitudeArcsec: Schema.Number, azimuthArcsec: Schema.Number, totalArcsec: Schema.Number })

const Sample = Schema.Struct({ capturedAt: Schema.String })

const Wcs = Schema.Struct({
  width: Schema.Number,
  height: Schema.Number,
  referenceX: Schema.Number,
  referenceY: Schema.Number,
  raDegrees: Schema.Number,
  decDegrees: Schema.Number,
  cd: Schema.Tuple([Schema.Number, Schema.Number, Schema.Number, Schema.Number]),
})

/**
 * What a trial's `journal.jsonl` is read for. A trial's lines also hold the observing site (`evidence.physical`,
 * `latitudeDegrees`, the mount's `longitudeDegrees` and sidereal times). None of those fields is named here, and a
 * schema drops what it does not name, so nothing read from a journal can carry the site out.
 */
const Entry = Schema.Union([
  Schema.Struct({
    type: Schema.Literal('run'),
    createdAt: Schema.String,
    run: Schema.Struct({ runId: Schema.String, rigId: Schema.String, mode: Schema.Literals(['offline', 'physical']), exposureSeconds: Schema.Number }),
  }),
  Schema.Struct({
    type: Schema.Literal('frame'),
    original: Schema.Struct({ filename: Schema.String, bytes: Schema.Number, sha256: Schema.String }),
    capture: Schema.Struct({ width: Schema.Int, height: Schema.Int, capturedAt: Schema.String, capturedAtSource: Schema.Literals(['camera', 'server-estimate']) }),
    evidence: Schema.Struct({
      phase: Schema.Literals(['baseline', 'adjusting']),
      position: Schema.Int,
      solution: Schema.Struct({ ...Position.fields, wcs: Wcs }),
      hint: Position,
      fieldHeightDegrees: Schema.Number,
    }),
  }),
  Schema.Struct({ type: Schema.Literal('baseline'), samples: Schema.Array(Sample), measurement: Polar }),
  Schema.Struct({ type: Schema.Literal('measurement'), sample: Sample, measurement: Polar }),
  Schema.Struct({ type: Schema.Literal('outcome'), phase: Schema.Literals(['finished', 'stopped', 'failed']) }),
])

export type TrialOutcome = 'finished' | 'stopped' | 'failed' | 'unfinished'

/** One frame a trial recorded: the pixels' digest, and the solve Vela got for them. */
export interface TrialFrame {
  readonly line: number
  readonly phase: 'baseline' | 'adjusting'
  readonly position: number
  readonly filename: string
  /** The UUID in the filename, when it has one. Vela's trial writer makes it for the file; it names no Cria or saved image. */
  readonly fileId: string | null
  readonly bytes: number
  readonly sha256: string
  readonly capturedAt: EpochMs
  readonly capturedAtSource: CapturedAtSource
  readonly width: number
  readonly height: number
  readonly solved: { readonly raDegrees: number; readonly decDegrees: number; readonly wcs: typeof Wcs.Type }
  readonly hint: typeof Position.Type
  readonly fieldHeightDegrees: number
  /** The file is still in the trial's folder. Vela keeps the three baselines and the last adjusting frame. */
  readonly onDisk: boolean
}

/** The polar-axis error Vela measured, with the time of the sample it came from (the last one, for a baseline). */
export interface AlignmentReading {
  readonly line: number
  readonly phase: 'baseline' | 'adjusting'
  readonly at: EpochMs
  readonly altitudeArcsec: number
  readonly azimuthArcsec: number
  readonly totalArcsec: number
}

export interface Trial {
  readonly directory: string
  /** The folder name's run id; the `run` line carries the same. */
  readonly runId: string
  readonly rigId: string
  readonly mode: 'offline' | 'physical'
  readonly createdAt: EpochMs
  readonly exposureSeconds: number
  readonly outcome: TrialOutcome
  readonly frames: readonly TrialFrame[]
  readonly readings: readonly AlignmentReading[]
  readonly baselines: number
  readonly measurements: number
}

export interface Trials {
  readonly trials: readonly Trial[]
  readonly problems: readonly SourceProblem[]
}

const folderName = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-[A-Za-z0-9]+$/

async function readTrial(directory: string, runId: string, problems: SourceProblem[]): Promise<Trial | undefined> {
  const path = join(directory, 'journal.jsonl')
  const read = await readJsonl(path, Entry)
  const files = new Set(await readdir(directory).catch(() => []))
  const frames: TrialFrame[] = []
  const readings: AlignmentReading[] = []
  let run: Extract<typeof Entry.Type, { type: 'run' }> | undefined
  let outcome: TrialOutcome = 'unfinished'
  let baselines = 0
  let measurements = 0

  problems.push(...read.problems)

  for (const { line, value } of read.rows) {
    switch (value.type) {
      case 'run':
        run ??= value
        break
      case 'baseline':
      case 'measurement': {
        const sample = value.type === 'baseline' ? value.samples[value.samples.length - 1] : value.sample
        const at = sample === undefined ? undefined : instantOf(sample.capturedAt)

        if (value.type === 'baseline') baselines++
        else measurements++

        if (at === undefined) problems.push({ path, line, reason: 'a timestamp is not an instant' })
        else readings.push({ line, phase: value.type === 'baseline' ? 'baseline' : 'adjusting', at, ...value.measurement })

        break
      }

      case 'outcome':
        outcome = value.phase
        break
      case 'frame': {
        const capturedAt = instantOf(value.capture.capturedAt)

        if (capturedAt === undefined) {
          problems.push({ path, line, reason: 'a timestamp is not an instant' })
          break
        }

        frames.push({
          line,
          phase: value.evidence.phase,
          position: value.evidence.position,
          filename: value.original.filename,
          fileId: /-([0-9a-f-]{36})\.fits$/.exec(value.original.filename)?.[1] ?? null,
          bytes: value.original.bytes,
          sha256: value.original.sha256,
          capturedAt,
          capturedAtSource: value.capture.capturedAtSource,
          width: value.capture.width,
          height: value.capture.height,
          solved: { raDegrees: value.evidence.solution.raDegrees, decDegrees: value.evidence.solution.decDegrees, wcs: value.evidence.solution.wcs },
          hint: value.evidence.hint,
          fieldHeightDegrees: value.evidence.fieldHeightDegrees,
          onDisk: files.has(value.original.filename),
        })
      }
    }
  }

  const createdAt = run === undefined ? undefined : instantOf(run.createdAt)

  if (run === undefined || createdAt === undefined) {
    problems.push({ path, line: null, reason: 'no readable run line' })

    return undefined
  }

  if (run.run.runId !== runId) problems.push({ path, line: null, reason: 'the run id differs from the folder name' })

  return { directory, runId, rigId: run.run.rigId, mode: run.run.mode, createdAt, exposureSeconds: run.run.exposureSeconds, outcome, frames, readings, baselines, measurements }
}

/**
 * Lists alignment trials under Vela's `alignment-diagnostics/trials` (`<run id>-<suffix>/journal.jsonl` and the saved
 * FITS files), oldest first. It reads each journal through a schema that leaves the site out, and writes nothing.
 */
export async function readTrials(root: string): Promise<Trials> {
  const trials: Trial[] = []
  const problems: SourceProblem[] = []
  let entries: string[]

  try {
    entries = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
  } catch (error) {
    return { trials, problems: [{ path: root, line: null, reason: reasonOf(error) }] }
  }

  for (const name of entries) {
    const runId = folderName.exec(name)?.[1]

    if (runId === undefined) continue

    const trial = await readTrial(join(root, name), runId, problems)

    if (trial) trials.push(trial)
  }

  return { trials: trials.toSorted((a, b) => a.createdAt - b.createdAt), problems }
}
