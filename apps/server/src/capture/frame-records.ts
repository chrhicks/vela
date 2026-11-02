import type {
  CaptureImage,
  CaptureImageProvenance,
  CaptureImageStatistics,
  CaptureSubject,
  FrameType,
} from '@vela/model/web'
import { pathToFileURL } from 'node:url'
import { epochMs, imageId, rigId, seal, sourceId, type RigEvent } from '@vela/rig-events'
import type { RunLog } from '../run-log/run-log.js'

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

/** What one attempt left behind, filed in the run log as a `frame` event once it settles. */
export interface FrameRecord {
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
  /** The saved `original.fits`; null unless the outcome is `saved`. */
  fits: { path: string; bytes: number } | null
  /** Null when no image arrived or star measurement was unavailable. */
  statistics: CaptureImageStatistics | null
}

export interface FrameRecords {
  /** Returns at once and never throws. */
  append(record: FrameRecord): void
}

export const noFrameRecords: FrameRecords = { append() {} }

const frameSource = sourceId('vela:capture')

/** The run log names a rig in lowercase letters, digits and hyphens. The server checks every catalog rig at start. */
export function frameRigId(id: string) {
  try {
    return rigId(id)
  } catch {
    throw new Error(`Rig id "${id}" cannot name a rig in the run log: use lowercase letters, digits and hyphens.`)
  }
}

function frameEvent(record: FrameRecord): RigEvent {
  const settledAt = epochMs(Date.parse(record.settledAt))

  return seal({
    rig: frameRigId(record.rigId),
    source: frameSource,
    kind: 'frame',
    at: settledAt,
    seenAt: settledAt,
    body: {
      runId: record.runId,
      attempt: record.attempt,
      startedAt: record.startedAt,
      settledAt: record.settledAt,
      exposureSeconds: record.exposureSeconds,
      frameType: record.frameType,
      subject: record.subject,
      outcome: record.outcome,
      message: record.message,
      provenance: record.provenance,
      image: record.image && { ...record.image, id: imageId(record.image.id), ref: record.fits && { uri: pathToFileURL(record.fits.path).href, bytes: record.fits.bytes, sha256: null } },
      statistics: record.statistics && { detectedStars: record.statistics.detectedStars, medianHfrPixels: record.statistics.medianHfrPixels },
      origin: 'capture-run',
    },
  })
}

/** Files each settled attempt in the run log as a `frame` event. A frame record is never the reason a capture stops. */
export function frameRecordsOn(log: Pick<RunLog, 'append'>): FrameRecords {
  return {
    append(record) {
      try {
        log.append(frameEvent(record))
      } catch (error) {
        console.error('Vela frame records:', error instanceof Error ? error.message : String(error))
      }
    },
  }
}
