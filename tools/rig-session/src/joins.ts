import type { FrameRecord, MountSample, SavedImage, TraceSpan } from './inputs.ts'
import type { IndiImage } from './indi.ts'
import type { RecordedDevice, RecordedOperation } from './recording.ts'

/**
 * How one row found another. `exact` is a shared key. `inferred` is a rule over times, so
 * it holds only as far as the clocks do. `ambiguous` means several rows fit and none is
 * picked. No match is `null`, never a guess.
 */
export type Link<Target> =
  | { readonly kind: 'exact' | 'inferred'; readonly target: Target }
  | { readonly kind: 'ambiguous'; readonly candidates: readonly Target[] }

/**
 * A saved frame belongs to the `capture.frame` span of its rig that was running when the
 * camera started the exposure. Spans of one rig do not overlap, so one candidate is the usual case.
 */
export function linkFrameToSpan(image: SavedImage, spans: readonly TraceSpan[]): Link<TraceSpan> | null {
  const capturedAt = image.capturedAt.getTime()

  const candidates = spans.filter(
    span =>
      span.captureFrame?.rigId === image.rigId &&
      span.captureFrame.outcome === 'saved' &&
      span.startedAt.getTime() <= capturedAt &&
      capturedAt <= span.endedAt.getTime(),
  )

  if (candidates.length === 0) return null

  const [only] = candidates

  if (only !== undefined && candidates.length === 1) return { kind: 'inferred', target: only }

  return { kind: 'ambiguous', candidates }
}

/**
 * A saved frame belongs to the attempt whose record names the image it saved. The image id is a
 * key, so a match is `exact`. Two records for one image would be a Vela fault, and neither is picked.
 */
export function linkFrameToAttempt(image: SavedImage, records: readonly FrameRecord[]): Link<FrameRecord> | null {
  const candidates = records.filter(record => record.rigId === image.rigId && record.imageId === image.id)

  return exactOrAmbiguous(candidates)
}

/** An attempt that saved an image belongs to the saved frame with that id. */
export function linkAttemptToFrame(record: FrameRecord, images: readonly SavedImage[]): Link<SavedImage> | null {
  if (record.imageId === null) return null

  return exactOrAmbiguous(images.filter(image => image.rigId === record.rigId && image.id === record.imageId))
}

/**
 * An attempt belongs to the Cria operation it names. The operation id is the key; an attempt that
 * has only a request id (Cria never admitted it, or the reply was lost) finds its operation by that.
 */
export function linkAttemptToOperation(record: FrameRecord, operations: readonly RecordedOperation[]): Link<RecordedOperation> | null {
  const byId = operations.filter(operation => operation.id === record.operationId)

  if (byId.length > 0 || record.requestId === null) return exactOrAmbiguous(byId)

  return exactOrAmbiguous(operations.filter(operation => operation.requestId === record.requestId))
}

/**
 * A wire event belongs to the operation on its device whose window covers it. Both times are Cria's
 * clock, so no cross-host offset enters. Cria's devices can share one INDI device (a power box that
 * is both weather and switch), so several operations can cover one event: then none is picked.
 */
export function linkEventToOperation(
  event: { readonly at: Date; readonly device: string | null },
  operations: readonly RecordedOperation[],
  devices: readonly RecordedDevice[],
): Link<RecordedOperation> | null {
  if (event.device === null) return null

  const ids = new Set(devices.flatMap(device => (device.indiDevice === event.device ? [device.id] : [])))

  const covering = operations.filter(
    operation => ids.has(operation.deviceId) && operation.acceptedAt <= event.at && event.at <= operation.settledAt,
  )

  const [only] = covering

  if (only === undefined) return null

  return covering.length === 1 ? { kind: 'inferred', target: only } : { kind: 'ambiguous', candidates: covering }
}

export interface LinkedImage {
  readonly image: IndiImage
  readonly operation: Link<RecordedOperation> | null
}

/**
 * The camera image of a frame is the one that arrived inside its operation's window. The frame
 * reaches the operation by a key (`exact`) and the operation reaches the image by time, so the chain is
 * `inferred`, and only as good as the clocks. A second image in the window, or an image that fits two
 * operations, leaves it `ambiguous`. Cria's hash is over its own ImageBytes, not the FITS file the recording
 * keeps, so the content cannot confirm it here.
 */
export function linkOperationToImage(operation: RecordedOperation, linked: readonly LinkedImage[]): Link<IndiImage> | null {
  const fits = linked.filter(({ operation: link }) => link !== null && (link.kind === 'ambiguous' ? link.candidates : [link.target]).includes(operation))

  const [only] = fits

  if (only === undefined) return null

  return fits.length === 1 && only.operation?.kind === 'inferred'
    ? { kind: 'inferred', target: only.image }
    : { kind: 'ambiguous', candidates: fits.map(({ image }) => image) }
}

function exactOrAmbiguous<Target>(candidates: readonly Target[]): Link<Target> | null {
  const [only] = candidates

  if (only === undefined) return null

  return candidates.length === 1 ? { kind: 'exact', target: only } : { kind: 'ambiguous', candidates }
}

export interface MountLink {
  readonly link: Link<Date>
  readonly ageSeconds: number
}

/**
 * The mount sample in force at `at`: the latest one not after it, and only if it is no older
 * than `maxAgeSeconds`. An older sample would show where the mount was, not where it is.
 * Sample times are unique.
 */
export function linkMountAsOf(at: Date, samples: readonly MountSample[], maxAgeSeconds: number): MountLink | null {
  let latest: Date | null = null

  for (const { sampledAt } of samples) {
    if (sampledAt <= at && (latest === null || sampledAt > latest)) latest = sampledAt
  }

  if (latest === null) return null

  const ageSeconds = (at.getTime() - latest.getTime()) / 1000

  if (ageSeconds > maxAgeSeconds) return null

  return { link: { kind: 'inferred', target: latest }, ageSeconds }
}
