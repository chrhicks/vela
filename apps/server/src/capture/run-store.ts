import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { CaptureSubject, FrameType } from '@vela/model/web'
import { frameTypes } from '../imaging/frame-type.js'

/** What a run asked for and how far it got. Written while the run is active, removed when it ends. */
export interface CaptureRunRecord {
  version: 1
  rigId: string
  runId: string
  startedAt: string
  exposureSeconds: number
  repeat: boolean
  /** Null repeats until stopped. */
  frameCount: number | null
  frameType: FrameType
  saveFrames: boolean
  subject: CaptureSubject | null
  completedCount: number
  savedCount: number
  integrationSeconds: number
}

/** What starting a run takes: a start request, or a resumed run's. */
export interface CaptureRunRequest {
  exposureSeconds: number
  repeat: boolean
  frameCount?: number
  saveFrames: boolean
  frameType: FrameType
  subject: CaptureSubject | null
}

/**
 * The run that was active when the server last went down, per rig. A record is present only while
 * its run is unfinished, so one found at startup is an interrupted run.
 */
export interface CaptureRunStore {
  unfinished(rigId: string): CaptureRunRecord | undefined
  /** Returns at once. A record that cannot be written is dropped, never raised to the capture. */
  save(record: CaptureRunRecord): void
  clear(rigId: string): void
  /** Resolves when every queued write has landed. */
  close(): Promise<void>
}

export function createMemoryCaptureRunStore(): CaptureRunStore {
  const records = new Map<string, CaptureRunRecord>()

  return {
    unfinished: rigId => records.get(rigId),
    save: record => void records.set(record.rigId, record),
    clear: rigId => void records.delete(rigId),
    close: async () => {},
  }
}

export const noCaptureRuns: CaptureRunStore = {
  unfinished: () => undefined,
  save() {},
  clear() {},
  close: async () => {},
}

/** Frames a resumed run takes: null repeats until stopped, 0 means the run had taken them all. */
export function remainingFrames(record: CaptureRunRecord): number | null {
  if (!record.repeat) return record.completedCount > 0 ? 0 : 1

  if (record.frameCount === null) return null

  return Math.max(0, record.frameCount - record.completedCount)
}

/** The same run over again for what is left of it, or undefined when nothing is. */
export function resumeRequest(record: CaptureRunRecord): CaptureRunRequest | undefined {
  const remaining = remainingFrames(record)

  if (remaining === 0) return undefined

  const { exposureSeconds, repeat, saveFrames, frameType, subject } = record
  const request: CaptureRunRequest = { exposureSeconds, repeat, saveFrames, frameType, subject }

  return record.repeat && remaining !== null ? { ...request, frameCount: remaining } : request
}

const subjectSchema = z.strictObject({ targetId: z.string(), name: z.string(), catalog: z.string() })

const recordSchema = z.strictObject({
  version: z.literal(1),
  rigId: z.string().min(1),
  runId: z.string().min(1),
  startedAt: z.string(),
  exposureSeconds: z.number().positive().finite(),
  repeat: z.boolean(),
  frameCount: z.number().int().positive().nullable(),
  frameType: z.enum(frameTypes),
  saveFrames: z.boolean(),
  subject: subjectSchema.nullable(),
  completedCount: z.number().int().nonnegative(),
  savedCount: z.number().int().nonnegative(),
  integrationSeconds: z.number().nonnegative().finite(),
})

const fileSchema = z.strictObject({ runs: z.record(z.string(), z.unknown()) })

interface CaptureRunStoreOptions {
  onError?: (error: Error) => void
}

/**
 * Keeps the records in one JSON file, rewritten whole through a temporary file so a crash never
 * leaves half a record. A missing, unreadable or corrupt file starts clean: losing track of an
 * interrupted run is better than a server that will not start. A record that does not parse is
 * dropped on its own.
 */
export async function openFileCaptureRunStore(
  path: string,
  { onError = error => console.error('Vela capture runs:', error.message) }: CaptureRunStoreOptions = {},
): Promise<CaptureRunStore> {
  const records = await readRecords(path, onError)
  let pending = Promise.resolve()
  let queued = false

  function write() {
    if (queued) return

    queued = true

    pending = pending.then(async () => {
      queued = false
      await writeRecords(path, Object.fromEntries(records))
    }).catch(error => {
      try {
        onError(error instanceof Error ? error : new Error(String(error)))
      } catch {}
    })
  }

  return {
    unfinished: rigId => records.get(rigId),
    save(record) {
      records.set(record.rigId, record)
      write()
    },
    clear(rigId) {
      if (records.delete(rigId)) write()
    },
    close: () => pending,
  }
}

async function readRecords(path: string, onError: (error: Error) => void) {
  const records = new Map<string, CaptureRunRecord>()
  let contents: string

  try {
    contents = await readFile(path, 'utf8')
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) onError(asError(error))

    return records
  }

  let file: z.infer<typeof fileSchema>

  try {
    file = fileSchema.parse(JSON.parse(contents))
  } catch {
    onError(new Error(`${path} is not a capture run file; starting with no unfinished runs`))

    return records
  }

  for (const [rigId, candidate] of Object.entries(file.runs)) {
    const record = recordSchema.safeParse(candidate)

    if (record.success && record.data.rigId === rigId) records.set(rigId, record.data)
    else onError(new Error(`Dropped an unreadable capture run record for ${rigId}`))
  }

  return records
}

async function writeRecords(path: string, runs: Record<string, CaptureRunRecord>) {
  const temporaryPath = `${path}.${randomUUID()}.tmp`

  await mkdir(dirname(path), { recursive: true })

  try {
    await writeFile(temporaryPath, `${JSON.stringify({ runs }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporaryPath, path)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {})
    throw error
  }
}

function asError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error))
}
