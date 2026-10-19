import { existsSync } from 'node:fs'
import { readFrameRecords, readMountCsv, readSavedImages, readTraces, type ReadResult } from './inputs.ts'
import { publishPackage } from './package.ts'
import type { LinkKind } from './schema.ts'
import { readRecording } from './recording.ts'
import { buildTables, type TimeWindow } from './tables.ts'

export interface SessionRequest {
  readonly name: string
  readonly window: TimeWindow
  readonly root: string
  readonly savedImagesDir: string | null
  readonly tracesFile: string | null
  readonly mountCsvFile: string | null
  readonly frameRecordsFile: string | null
  readonly recordingDir: string | null
}

const whatMissingCosts = {
  'saved-images': 'There are no frames.',
  traces: 'There are no spans, and frames have no span link or run frame index.',
  'mount-csv': 'The mount table is empty and frames have no mount link.',
  'indi-recording': 'There are no Cria operations, INDI writes or device events, and no frame links exactly to its camera image.',
  'frame-records': 'Frames carry no request or operation ids, so none links exactly to a Cria operation.',
} as const

type InputName = keyof typeof whatMissingCosts

type InputReport =
  | { readonly input: InputName; readonly status: 'found'; readonly path: string; readonly read: number; readonly skipped: number }
  | { readonly input: InputName; readonly status: 'missing'; readonly effect: string }

const maxSkippedListed = 20

/** Reads the inputs it was given, joins them, and publishes the package. Returns the new package directory. */
export async function buildSession(request: SessionRequest): Promise<string> {
  const savedImages = await readIfGiven(request.savedImagesDir, readSavedImages)
  const traces = await readIfGiven(request.tracesFile, readTraces)
  const mount = await readIfGiven(request.mountCsvFile, readMountCsv)
  const frameRecords = await readIfGiven(request.frameRecordsFile, readFrameRecords)
  const recording = await readIfGiven(request.recordingDir, readRecording)

  const tables = buildTables(request.name, request.window, {
    savedImages: savedImages?.items ?? [],
    spans: traces?.items ?? [],
    frameRecords: frameRecords?.items ?? [],
    recording,
    mountSamples: mount?.items ?? [],
  })

  const skipped = [savedImages, traces, mount, frameRecords, recording].flatMap(result => result?.skipped ?? [])

  const summary = {
    session: request.name,
    builtAt: new Date().toISOString(),
    window: { from: request.window.from.toISOString(), to: request.window.to.toISOString() },
    inputs: [
      reportInput('saved-images', request.savedImagesDir, savedImages),
      reportInput('traces', request.tracesFile, traces),
      reportInput('mount-csv', request.mountCsvFile, mount),
      reportInput('indi-recording', request.recordingDir, recording),
      reportInput('frame-records', request.frameRecordsFile, frameRecords),
    ],
    rows: {
      frames: tables.frames.length,
      attempts: tables.attempts.length,
      indi_ops: tables.indi_ops.length,
      mount: tables.mount.length,
      spans: tables.spans.length,
    },
    links: {
      frame_to_span: countLinks(tables.frames.map(frame => frame.span_link)),
      frame_to_mount: countLinks(tables.frames.map(frame => frame.mount_link)),
      frame_to_attempt: countLinks(tables.frames.map(frame => frame.attempt_link)),
      frame_to_operation: countLinks(tables.frames.map(frame => frame.operation_link)),
      attempt_to_operation: countLinks(tables.attempts.map(attempt => attempt.operation_link)),
    },
    recording: recording && {
      name: recording.name,
      instanceId: recording.instanceId,
      startedAt: recording.startedAt.toISOString(),
      ended: recording.ended,
      tornTail: recording.tornTail,
      gaps: recording.items.filter(line => line.k === 'gap').length,
    },
    skipped: skipped.slice(0, maxSkippedListed),
  }

  return publishPackage(request.root, tables, `${JSON.stringify(summary, null, 2)}\n`)
}

async function readIfGiven<Result extends ReadResult<unknown>>(
  path: string | null,
  read: (path: string) => Promise<Result>,
): Promise<Result | null> {
  if (path === null || !existsSync(path)) return null

  return read(path)
}

function reportInput<Item>(input: InputName, path: string | null, result: ReadResult<Item> | null): InputReport {
  if (path === null || result === null) return { input, status: 'missing', effect: whatMissingCosts[input] }

  return { input, status: 'found', path, read: result.items.length, skipped: result.skipped.length }
}

function countLinks(kinds: readonly (LinkKind | null)[]) {
  return {
    exact: kinds.filter(kind => kind === 'exact').length,
    inferred: kinds.filter(kind => kind === 'inferred').length,
    ambiguous: kinds.filter(kind => kind === 'ambiguous').length,
    none: kinds.filter(kind => kind === null).length,
  }
}
