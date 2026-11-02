import { createReadStream } from 'node:fs'
import { open, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import {
  createIndiImporter,
  createJournalImporter,
  decodeManifest,
  decodeRecordingLine,
  epochMs,
  parseRequest,
  rigId,
  sourceId,
  type EpochMs,
  type RecordingManifest,
  type RigEvent,
} from '@vela/rig-events'
import type { Exposure } from './backfill-analysis.ts'

export interface Window {
  readonly from: EpochMs
  readonly to: EpochMs
}

const halfDayMs = 43_200_000

/** A night runs from local noon to local noon and is named for the date it starts, as `nightOf` names it. */
export function nightWindow(night: string, utcOffsetMinutes: number): Window {
  const noonUtc = Date.parse(`${night}T12:00:00Z`)

  return { from: epochMs(noonUtc - utcOffsetMinutes * 60_000), to: epochMs(noonUtc - utcOffsetMinutes * 60_000 + 2 * halfDayMs) }
}

export interface Recording {
  readonly path: string
  readonly manifest: RecordingManifest
  readonly from: number
  readonly to: number
}

const timeOf = (line: string) => Number(/"at":(\d+)/.exec(line)?.[1] ?? Number.NaN)

async function edgeLine(path: string, edge: 'first' | 'last'): Promise<string> {
  const file = await open(path, 'r')

  try {
    const { size } = await file.stat()
    const length = Math.min(size, 1 << 20)
    const buffer = Buffer.alloc(length)

    await file.read(buffer, 0, length, edge === 'first' ? 0 : size - length)

    const lines = buffer.toString('utf8').trimEnd().split('\n')

    return (edge === 'first' ? lines[0] : lines[lines.length - 1]) ?? ''
  } finally {
    await file.close()
  }
}

/** Errai's INDI recordings (one folder per Cria run) with the time each one spans, oldest first. */
export async function readRecordings(directory: string): Promise<Recording[]> {
  const found: Recording[] = []

  for (const name of (await readdir(directory)).sort()) {
    const path = join(directory, name)
    const manifest = decodeManifest(JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8')))
    const from = timeOf(await edgeLine(join(path, 'traffic.jsonl'), 'first'))
    const to = timeOf(await edgeLine(join(path, 'traffic.jsonl'), 'last'))

    if (Number.isFinite(from) && Number.isFinite(to)) found.push({ path, manifest, from, to })
  }

  return found.toSorted((a, b) => a.from - b.from)
}

export const overlapping = (recordings: readonly Recording[], window: Window) => recordings.filter(recording => recording.from < window.to && recording.to >= window.from)

/** The mount's snapshots from the recordings that overlap the window, in the order they arrived. */
export async function* recordedMount(recordings: readonly Recording[], window: Window): AsyncGenerator<RigEvent> {
  for (const recording of overlapping(recordings, window)) {
    const importer = createIndiImporter({ rig: rigId('backfill'), source: sourceId('import:indi-recording'), manifest: recording.manifest })

    for await (const line of createInterface({ input: createReadStream(join(recording.path, 'traffic.jsonl')), crlfDelay: Infinity })) {
      if (timeOf(line) >= window.to) break

      const result = importer.read(line)

      if (result?.ok && result.event.kind === 'cria.state' && result.event.seenAt >= window.from) yield result.event
    }
  }
}

/** The mount's snapshots rebuilt from Vela's journal files, given oldest first. A baseline line in the file seeds the cells, so the file is read from its start. */
export async function* journaledMount(paths: readonly string[], window: Window): AsyncGenerator<RigEvent> {
  const importer = createJournalImporter({ rig: rigId('backfill'), source: sourceId('import:vela-journal') })

  for (const path of paths) {
    for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
      if (timeOf(line) >= window.to) break

      const result = importer.read(line)

      if (result.ok && result.event.kind === 'cria.state' && result.event.seenAt >= window.from) yield result.event
    }
  }
}

/** What Cria told the imaging camera to expose, from the recordings that overlap the window. */
export async function commandedExposures(recordings: readonly Recording[], window: Window): Promise<Exposure[]> {
  const commanded: Exposure[] = []

  for (const recording of overlapping(recordings, window)) {
    const camera = recording.manifest.devices.find(device => device.id === 'primary' && device.kind === 'camera')

    if (camera === undefined) continue

    for await (const line of createInterface({ input: createReadStream(join(recording.path, 'traffic.jsonl')), crlfDelay: Infinity })) {
      if (timeOf(line) >= window.to) break

      if (!line.includes('"dir":"out"') || !line.includes('CCD_EXPOSURE')) continue

      const entry = decodeRecordingLine(JSON.parse(line))
      const request = entry.k === 'msg' ? parseRequest(entry.xml) : undefined
      const seconds = request?.elements.get('CCD_EXPOSURE_VALUE')

      if (entry.k === 'msg' && entry.at >= window.from && request?.device === camera.indiDevice && request.name === 'CCD_EXPOSURE' && seconds?.kind === 'number')
        commanded.push({ at: epochMs(entry.at), seconds: seconds.value })
    }
  }

  return commanded
}
