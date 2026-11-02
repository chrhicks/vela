import { Schema } from 'effect'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { RigEventSchema, SkyPosition, type Envelope, type EpochMs } from '@vela/rig-events'
import { runLogFiles } from './frame-records.ts'
import { readJsonl, reasonOf, type SourceProblem } from './jsonl.ts'
import type { CapturedAtSource } from './saved-images.ts'
import { instantOf, isoOf } from './times.ts'

const Position = SkyPosition

const Polar = Schema.Struct({ altitudeArcsec: Schema.Number, azimuthArcsec: Schema.Number, totalArcsec: Schema.Number })

const Sample = Schema.Struct({ capturedAt: Schema.String })

const Step = Schema.Struct({ labelBefore: Schema.String, labelAfter: Schema.String })

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
  Schema.Struct({
    type: Schema.Literal('fit'),
    fixes: Schema.Array(Schema.Struct({ position: Schema.Int, sample: Sample })),
    polar: Schema.NullOr(Polar),
    verdict: Schema.Struct({ status: Schema.Literals(['rigid', 'not-rigid']), missArcmin: Schema.Number, thresholdArcmin: Schema.Number, steps: Schema.Array(Step) }),
  }),
  Schema.Struct({ type: Schema.Literal('dropped'), position: Schema.Int, reason: Schema.Literals(['no-solve', 'rejected', 'capture-failed']) }),
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

/** A sweep fit: which positions it used and whether the mount turned rigidly. A step names the two positions either side of it. */
export interface TrialFit {
  readonly line: number
  readonly at: EpochMs
  readonly positions: readonly number[]
  readonly status: 'rigid' | 'not-rigid'
  readonly missArcmin: number
  readonly thresholdArcmin: number
  readonly steps: readonly { readonly before: string; readonly after: string }[]
}

/** A sweep position that gave no fix, and why. */
export interface DroppedFix {
  readonly line: number
  readonly position: number
  readonly reason: 'no-solve' | 'rejected' | 'capture-failed'
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
  /** Polar errors Vela reported. A not-rigid fit adds none: its error is not a polar error. */
  readonly readings: readonly AlignmentReading[]
  readonly fits: readonly TrialFit[]
  readonly dropped: readonly DroppedFix[]
  readonly baselines: number
  readonly measurements: number
}

export interface Trials {
  readonly trials: readonly Trial[]
  readonly problems: readonly SourceProblem[]
}

const folderName = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-[A-Za-z0-9]+$/

const polarOf = ({ altitudeArcsec, azimuthArcsec, totalArcsec }: typeof Polar.Type) => ({ altitudeArcsec, azimuthArcsec, totalArcsec })

interface TrialRows {
  readonly path: string
  readonly rows: readonly { readonly line: number; readonly value: typeof Entry.Type }[]
}

async function readTrial(directory: string, runId: string, { path, rows }: TrialRows, problems: SourceProblem[]): Promise<Trial | undefined> {
  const files = new Set(await readdir(directory).catch(() => []))
  const frames: TrialFrame[] = []
  const readings: AlignmentReading[] = []
  const fits: TrialFit[] = []
  const dropped: DroppedFix[] = []
  let run: Extract<typeof Entry.Type, { type: 'run' }> | undefined
  let outcome: TrialOutcome = 'unfinished'
  let baselines = 0
  let measurements = 0

  for (const { line, value } of rows) {
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
        else readings.push({ line, phase: value.type === 'baseline' ? 'baseline' : 'adjusting', at, ...polarOf(value.measurement) })

        break
      }

      case 'dropped':
        dropped.push({ line, position: value.position, reason: value.reason })
        break
      case 'fit': {
        const last = value.fixes[value.fixes.length - 1]
        const at = last === undefined ? undefined : instantOf(last.sample.capturedAt)

        if (at === undefined) {
          problems.push({ path, line, reason: 'a timestamp is not an instant' })
          break
        }

        const { status, missArcmin, thresholdArcmin, steps } = value.verdict

        fits.push({ line, at, positions: value.fixes.map(fix => fix.position), status, missArcmin, thresholdArcmin, steps: steps.map(step => ({ before: step.labelBefore, after: step.labelAfter })) })

        if (status === 'rigid' && value.polar) readings.push({ line, phase: 'baseline', at, ...polarOf(value.polar) })

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

  return { directory, runId, rigId: run.run.rigId, mode: run.run.mode, createdAt, exposureSeconds: run.run.exposureSeconds, outcome, frames, readings, fits, dropped, baselines, measurements }
}

function entryOf(event: Envelope<'alignment'>): typeof Entry.Type {
  const { body } = event

  if (body.type !== 'run') return body

  return { type: 'run', createdAt: isoOf(event.at), run: { runId: body.runId, rigId: event.rig, mode: body.mode, exposureSeconds: body.exposureSeconds } }
}

async function readLoggedTrials(runLog: string, problems: SourceProblem[]): Promise<Map<string, TrialRows>> {
  const byRun = new Map<string, { folder?: string; rows: { line: number; value: typeof Entry.Type }[] }>()
  const seen = new Set<string>()
  let files: readonly string[]

  try {
    files = await runLogFiles(runLog)
  } catch (error) {
    problems.push({ path: runLog, line: null, reason: reasonOf(error) })

    return new Map()
  }

  for (const file of files) {
    const read = await readJsonl(file, RigEventSchema, text => !text.includes('"kind":"alignment"'))

    problems.push(...read.problems)

    for (const { value: event } of read.rows) {
      if (event.kind !== 'alignment' || seen.has(event.id)) continue

      seen.add(event.id)

      const { runId, n } = event.body
      const run = byRun.get(runId) ?? { rows: [] }

      byRun.set(runId, run)
      run.rows.push({ line: n, value: entryOf(event) })

      if (event.body.type === 'run') run.folder = event.body.folder
    }
  }

  return new Map(
    [...byRun.values()].flatMap(({ folder, rows }) => (folder === undefined ? [] : [[folder, { path: runLog, rows: rows.toSorted((a, b) => a.line - b.line) }] as const])),
  )
}

/**
 * Lists alignment trials, oldest first. A trial is a folder under Vela's `alignment-diagnostics/trials`
 * (`<run id>-<suffix>`, with the saved FITS files) whose entries are either its `journal.jsonl` or the
 * `alignment` events of the run log (`runLog`, a directory or a file) that name the folder. It reads both through a schema
 * that leaves the site out, and writes nothing.
 */
export async function readTrials(root: string, runLog?: string): Promise<Trials> {
  const trials: Trial[] = []
  const problems: SourceProblem[] = []
  let entries: string[] = []

  try {
    entries = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name)
  } catch (error) {
    problems.push({ path: root, line: null, reason: reasonOf(error) })
  }

  const logged = runLog === undefined ? new Map<string, TrialRows>() : await readLoggedTrials(runLog, problems)

  for (const name of [...new Set([...entries, ...logged.keys()])].toSorted()) {
    const runId = folderName.exec(name)?.[1]

    if (runId === undefined) continue

    const directory = join(root, name)
    let source = logged.get(name)

    if (source === undefined) {
      const path = join(directory, 'journal.jsonl')
      const read = await readJsonl(path, Entry)

      problems.push(...read.problems)
      source = { path, rows: read.rows }
    }

    const trial = await readTrial(directory, runId, source, problems)

    if (trial) trials.push(trial)
  }

  return { trials: trials.toSorted((a, b) => a.createdAt - b.createdAt), problems }
}
