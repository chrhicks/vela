import { pathToFileURL } from 'node:url'
import type { Draft, Envelope, RigId, SourceId } from '@vela/rig-events'
import type { FrameRecord } from './frame-records.ts'
import type { SavedImage } from './saved-images.ts'
import { isoOf } from './times.ts'

/**
 * The `frame` fact for one settled attempt. Its `at` and `seenAt` are the moment the attempt settled, when Vela
 * learned the outcome; the exposure itself is `image.capturedAt`. The file reference is the saved `original.fits`
 * when the store has it, with no digest (hashing every file would read the whole store).
 */
export function frameDraft(record: FrameRecord, image: SavedImage | undefined, rig: RigId, source: SourceId): Draft<Envelope<'frame'>> {
  const named = record.image

  return {
    rig,
    source,
    kind: 'frame',
    at: record.settledAt,
    seenAt: record.settledAt,
    body: {
      runId: record.runId,
      attempt: record.attempt,
      startedAt: isoOf(record.startedAt),
      settledAt: isoOf(record.settledAt),
      exposureSeconds: record.exposureSeconds,
      frameType: record.frameType,
      subject: record.subject,
      outcome: record.outcome,
      image:
        named === null
          ? null
          : {
              id: named.id,
              capturedAt: isoOf(named.capturedAt),
              capturedAtSource: named.capturedAtSource,
              receivedAt: isoOf(named.receivedAt),
              width: named.width,
              height: named.height,
              ref: image === undefined ? null : { uri: pathToFileURL(image.fitsPath).href, bytes: image.fitsBytes, sha256: null },
            },
      statistics: record.statistics,
      origin: 'capture-run',
    },
  }
}
