import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type {
  CaptureImage,
  CaptureImageProvenance,
  CaptureImageStatistics,
  CaptureSubject,
  FrameType,
} from '@vela/model/web'

/**
 * How one exposure attempt ended. `saved`, `unsaved` and `save-failed` all hold an image; the rest
 * hold none. `lost` is an image the camera service dropped before Vela fetched it; `uncertain` is
 * an exposure whose outcome Vela could not learn.
 */
export type FrameOutcome =
  | 'saved'
  | 'unsaved'
  | 'save-failed'
  | 'lost'
  | 'failed'
  | 'uncertain'
  | 'stopped'

/** One line of the frame record file, written once when the attempt settles. */
export interface FrameRecord {
  version: 1
  rigId: string
  /** Identifies the capture run; `attempt` restarts at 1 in each run. */
  runId: string
  attempt: number
  /** Vela's clock when the exposure was requested and when the attempt settled. */
  startedAt: string
  settledAt: string
  exposureSeconds: number
  /** Lines written before frame types existed lack it; they are lights. */
  frameType: FrameType
  subject: CaptureSubject | null
  outcome: FrameOutcome
  /** Why the attempt did not end well; null for `saved` and `unsaved`. */
  message: string | null
  /** Ids the adapter had when the attempt ended; null when the adapter carries none. */
  provenance: CaptureImageProvenance | null
  /** Null when no image arrived. `id` matches the saved image's `metadata.json`. */
  image: {
    id: string
    capturedAt: string
    capturedAtSource: NonNullable<CaptureImage['capturedAtSource']>
    receivedAt: string
    width: number
    height: number
  } | null
  /** Null when no image arrived or star measurement was unavailable. */
  statistics: CaptureImageStatistics | null
}

export interface FrameRecords {
  /** Returns at once. A record that cannot be written is dropped, never raised to the capture. */
  append(record: FrameRecord): void
  close(): Promise<void>
}

export const noFrameRecords: FrameRecords = {
  append() {},
  async close() {},
}

interface FrameRecordOptions {
  maxPendingBytes?: number
  onError?: (error: Error) => void
}

/**
 * Appends one JSON line per settled attempt. The first failure, or a backlog above
 * `maxPendingBytes`, switches recording off until the server restarts, so a line is never
 * half written in the middle of the file.
 */
export function openFrameRecords(
  path: string,
  {
    maxPendingBytes = 1024 * 1024,
    onError = error => console.error('Vela frame records:', error.message),
  }: FrameRecordOptions = {},
): FrameRecords {
  const file = resolve(path)
  let pending = Promise.resolve()
  let pendingBytes = 0
  let off = false

  function latchOff(error: Error) {
    if (off) return
    off = true
    pendingBytes = 0

    try {
      onError(error)
    } catch {}
  }

  return {
    append(record) {
      if (off) return
      const line = `${JSON.stringify(record)}\n`
      const size = Buffer.byteLength(line)

      if (pendingBytes + size > maxPendingBytes)
        return latchOff(new Error('Writing fell behind; frame records are off until restart'))

      pendingBytes += size

      pending = pending
        .then(async () => {
          if (off) return
          await mkdir(dirname(file), { recursive: true })
          await appendFile(file, line, { mode: 0o600 })
        })
        .catch(error => latchOff(error instanceof Error ? error : new Error(String(error))))
        .finally(() => {
          if (!off) pendingBytes -= size
        })
    },
    close: () => pending,
  }
}
