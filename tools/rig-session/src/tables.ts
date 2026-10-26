import { journalRows } from './journal-tables.ts'
import type { JournalEntry } from './journal.ts'
import type { FrameRecord, MountSample, SavedImage, TraceSpan } from './inputs.ts'
import type { IndiEvent, IndiImage } from './indi.ts'
import { linkAttemptToFrame, linkToOperation, linkEventToOperation, linkFrameToAttempt, linkOperationToImage, linkFrameToSpan, linkMountAsOf, type Link, type LinkedImage, type MountLink } from './joins.ts'
import { operationsOf, type RecordedOperation, type Recording } from './recording.ts'
import type { AttemptRow, FrameRow, IndiEventRow, IndiImageRow, IndiOpRow, LinkKind, MountRow, SpanRow, Tables } from './schema.ts'

export interface TimeWindow {
  readonly from: Date
  readonly to: Date
}

export interface SessionInputs {
  readonly savedImages: readonly SavedImage[]
  readonly spans: readonly TraceSpan[]
  readonly frameRecords: readonly FrameRecord[]
  readonly recording: Recording | null
  readonly journal: readonly JournalEntry[]
  readonly mountSamples: readonly MountSample[]
}

/** The CSV logs every 10 seconds. A sample three times older than that has missed its beat. */
export const mountFreshSeconds = 30

/**
 * Joins the raw inputs of one session into table rows. Pure: the same inputs give the same rows.
 * The window picks the frames, and the mount and span rows that start inside it. Links look at
 * every input, so a frame at the start of the window still finds the mount sample just before it.
 * Such a link would join to nothing if its target were left out, so the rows a frame links to
 * are exported too, even when they fall before the window.
 */
export function buildTables(session: string, window: TimeWindow, inputs: SessionInputs): Tables {
  const inWindow = (time: Date) => window.from <= time && time < window.to
  const operations = inputs.recording ? operationsOf(inputs.recording) : []
  const savedImages = inputs.savedImages.filter(image => inWindow(image.capturedAt))
  const devices = inputs.recording?.devices ?? []
  const indiMount = inputs.recording?.mountSamples ?? []
  const indiTimes = new Set(indiMount.map(sample => sample.sampledAt.getTime()))
  const mountSamples = [...inputs.mountSamples.filter(sample => !indiTimes.has(sample.sampledAt.getTime())), ...indiMount]
  const imageOperations = operations.filter(operation => operation.outcome.value?.image)

  const linkedImages: LinkedImage[] = (inputs.recording?.images ?? []).map(image => ({
    image,
    operation: linkEventToOperation(image, imageOperations, devices),
  }))

  const frames = savedImages.map(image => {
    const spanLink = linkFrameToSpan(image, inputs.spans)
    const mount = linkMountAsOf(image.capturedAt, mountSamples, mountFreshSeconds)

    const attemptLink = linkFrameToAttempt(image, inputs.frameRecords)
    const attempt = attemptLink?.kind === 'exact' ? attemptLink.target : null

    const operationLink = attempt && linkToOperation(attempt, operations)
    const blobLink = operationLink?.kind === 'exact' ? linkOperationToImage(operationLink.target, linkedImages) : null

    return { image, spanLink, mount, attemptLink, operationLink, blobLink }
  })

  const linkedSpans = new Set(frames.flatMap(({ spanLink }) => linkTargets(spanLink)))
  const linkedMountTimes = new Set(frames.flatMap(({ mount }) => linkTargets(mount?.link ?? null).map(time => time.getTime())))

  const journal = journalRows(session, inputs.journal, inWindow, inputs.frameRecords, operations)
  const linkedAttempts = new Set([...frames.flatMap(({ attemptLink }) => linkTargets(attemptLink)), ...journal.linkedAttempts])
  const exportedImages = frames.map(({ image }) => image)
  const exportedAttempts = inputs.frameRecords.filter(record => inWindow(record.startedAt) || linkedAttempts.has(record))
  const attemptOperations = exportedAttempts.map(record => linkToOperation(record, operations))

  const events = (inputs.recording?.events ?? []).filter(event => inWindow(event.at))
  const eventOperations = events.map(event => linkEventToOperation(event, operations, devices))

  const linkedBlobs = new Set(frames.flatMap(({ blobLink }) => linkTargets(blobLink)))
  const exportedBlobs = linkedImages.filter(({ image }) => inWindow(image.at) || linkedBlobs.has(image))

  const operationLinks = [...frames.map(({ operationLink }) => operationLink), ...attemptOperations, ...eventOperations, ...exportedBlobs.map(({ operation }) => operation)]
  const linkedOperations = new Set([...operationLinks.flatMap(link => linkTargets(link)), ...journal.linkedOperations])

  return {
    frames: frames.map(({ image, spanLink, mount, attemptLink, operationLink, blobLink }) =>
      frameRow(session, image, spanLink, mount, attemptLink, operationLink, blobLink),
    ),
    attempts: exportedAttempts.map((record, index) => attemptRow(session, record, linkAttemptToFrame(record, exportedImages), attemptOperations[index] ?? null)),
    indi_ops: operations
      .filter(operation => inWindow(operation.acceptedAt) || linkedOperations.has(operation))
      .map(operation => operationRow(session, operation, inputs.recording)),
    indi_events: events.map((event, index) => eventRow(session, event, eventOperations[index] ?? null)),
    indi_images: exportedBlobs.map(({ image, operation }) => imageRow(session, image, operation)),
    cria_requests: journal.requests,
    cria_image_checks: journal.imageChecks,
    cria_state_changes: journal.stateChanges,
    cria_stream: journal.streamEvents,
    mount: mountSamples.flatMap(sample =>
      inWindow(sample.sampledAt) || linkedMountTimes.has(sample.sampledAt.getTime()) ? [mountRow(session, sample)] : [],
    ),
    spans: inputs.spans.filter(span => inWindow(span.startedAt) || linkedSpans.has(span)).map(span => spanRow(session, span)),
  }
}

function linkTargets<Target>(link: Link<Target> | null): readonly Target[] {
  if (link === null) return []

  return link.kind === 'ambiguous' ? link.candidates : [link.target]
}

function frameRow(
  session: string,
  image: SavedImage,
  spanLink: Link<TraceSpan> | null,
  mount: MountLink | null,
  attemptLink: Link<FrameRecord> | null,
  operationLink: Link<RecordedOperation> | null,
  blobLink: Link<IndiImage> | null,
): FrameRow {
  const span = spanLink?.kind === 'ambiguous' ? null : (spanLink?.target ?? null)
  const attempt = attemptLink?.kind === 'ambiguous' ? null : (attemptLink?.target ?? null)
  const mountLink = mount?.link ?? null

  return {
    session,
    frame_id: image.id,
    captured_at: image.capturedAt,
    captured_at_source: image.capturedAtSource,
    received_at: image.receivedAt,
    exposure_seconds: image.exposureSeconds,
    width: image.width,
    height: image.height,
    camera_name: image.cameraName,
    rig_id: image.rigId,
    target_id: image.targetId,
    target_name: image.targetName,
    star_algorithm_version: image.starAlgorithmVersion,
    detected_stars: image.detectedStars,
    median_hfr_px: image.medianHfrPixels,
    star_detections: image.starDetections,
    star_measured: image.starMeasured,
    star_strong: image.starStrong,
    star_rejected: image.starRejected,
    sky_level: image.skyLevel,
    sky_noise: image.skyNoise,
    star_axis_ratio: image.starAxisRatio,
    saved_dir: image.directory,
    span_id: span?.spanId ?? null,
    span_link: linkKind(spanLink),
    span_candidates: candidates(spanLink, candidate => candidate.spanId),
    run_frame_index: span?.captureFrame?.index ?? null,
    mount_sampled_at: mountLink?.kind === 'ambiguous' ? null : (mountLink?.target ?? null),
    mount_link: linkKind(mountLink),
    mount_candidates: candidates(mountLink, candidate => candidate.toISOString()),
    mount_age_seconds: mount?.ageSeconds ?? null,
    run_id: attempt?.runId ?? null,
    attempt: attempt?.attempt ?? null,
    request_id: attempt?.requestId ?? null,
    operation_id: attempt?.operationId ?? null,
    cria_image_id: attempt?.criaImageId ?? null,
    attempt_link: linkKind(attemptLink),
    attempt_candidates: candidates(attemptLink, candidate => `${candidate.runId}/${candidate.attempt}`),
    operation_link: linkKind(operationLink),
    operation_candidates: candidates(operationLink, candidate => candidate.id),
    blob_path: blobLink?.kind === 'ambiguous' ? null : (blobLink?.target.path ?? null),
    blob_link: linkKind(blobLink),
    blob_candidates: candidates(blobLink, candidate => candidate.path),
  }
}

function attemptRow(session: string, record: FrameRecord, frameLink: Link<SavedImage> | null, operationLink: Link<RecordedOperation> | null): AttemptRow {
  const frame = frameLink?.kind === 'ambiguous' ? null : (frameLink?.target ?? null)

  return {
    session,
    run_id: record.runId,
    attempt: record.attempt,
    rig_id: record.rigId,
    started_at: record.startedAt,
    settled_at: record.settledAt,
    exposure_seconds: record.exposureSeconds,
    outcome: record.outcome,
    message: record.message,
    request_id: record.requestId,
    operation_id: record.operationId,
    cria_image_id: record.criaImageId,
    frame_id: frame?.id ?? null,
    frame_link: linkKind(frameLink),
    frame_candidates: candidates(frameLink, candidate => candidate.directory),
    operation_link: linkKind(operationLink),
    operation_candidates: candidates(operationLink, candidate => candidate.id),
    star_algorithm_version: record.starAlgorithmVersion,
    detected_stars: record.detectedStars,
    median_hfr_px: record.medianHfrPixels,
    star_detections: record.starDetections,
    star_measured: record.starMeasured,
    star_strong: record.starStrong,
    star_rejected: record.starRejected,
    sky_level: record.skyLevel,
    sky_noise: record.skyNoise,
    star_axis_ratio: record.starAxisRatio,
  }
}

function operationRow(session: string, operation: RecordedOperation, recording: Recording | null): IndiOpRow {
  const image = operation.outcome.value?.image ?? null

  return {
    session,
    operation_id: operation.id,
    request_id: operation.requestId,
    instance_id: operation.instanceId,
    device_id: operation.deviceId,
    indi_device: recording?.devices.find(device => device.id === operation.deviceId)?.indiDevice ?? null,
    kind: operation.kind,
    accepted_at: operation.acceptedAt,
    started_at: operation.startedAt ?? null,
    settled_at: operation.settledAt,
    outcome: operation.outcome.kind,
    outcome_reason: operation.outcome.reason ?? null,
    outcome_message: operation.outcome.message ?? null,
    parameters: JSON.stringify(operation.parameters ?? null),
    image_id: image?.id ?? null,
    image_bytes: image?.original?.bytes ?? null,
    image_sha256: image?.sha256 ?? null,
  }
}

function eventRow(session: string, event: IndiEvent, operationLink: Link<RecordedOperation> | null): IndiEventRow {
  const operation = operationLink?.kind === 'ambiguous' ? null : (operationLink?.target ?? null)

  return {
    session,
    at: event.at,
    conn: event.conn,
    direction: event.direction,
    n: event.n,
    kind: event.kind,
    device: event.device,
    property: event.property,
    state: event.state,
    values: event.values && JSON.stringify(event.values),
    changed: event.changed && JSON.stringify(event.changed),
    text: event.text,
    operation_id: operation?.id ?? null,
    operation_link: linkKind(operationLink),
    operation_candidates: candidates(operationLink, candidate => candidate.id),
  }
}

function imageRow(session: string, image: IndiImage, operationLink: Link<RecordedOperation> | null): IndiImageRow {
  const operation = operationLink?.kind === 'ambiguous' ? null : (operationLink?.target ?? null)

  return {
    session,
    at: image.at,
    conn: image.conn,
    n: image.n,
    device: image.device,
    property: image.property,
    element: image.element,
    blob_path: image.path,
    blob_bytes: image.bytes,
    operation_id: operation?.id ?? null,
    operation_link: linkKind(operationLink),
    operation_candidates: candidates(operationLink, candidate => candidate.id),
    image_id: operation?.outcome.value?.image?.id ?? null,
    image_bytes: operation?.outcome.value?.image?.original?.bytes ?? null,
  }
}

function mountRow(session: string, sample: MountSample): MountRow {
  return {
    session,
    source: sample.source,
    sampled_at: sample.sampledAt,
    ra_hours: sample.raHours,
    dec_degrees: sample.decDegrees,
    lst_hours: sample.lstHours,
    hour_angle_hours: sample.lstHours === null ? null : hourAngle(sample.lstHours, sample.raHours),
    tracking: sample.tracking,
    slewing: sample.slewing,
    parked: sample.parked,
    pier_side: sample.pierSide,
    track_mode: sample.trackMode,
  }
}

function spanRow(session: string, span: TraceSpan): SpanRow {
  return {
    session,
    trace_id: span.traceId,
    span_id: span.spanId,
    name: span.name,
    started_at: span.startedAt,
    ended_at: span.endedAt,
    duration_ms: span.durationMs,
    status_code: span.statusCode,
    attributes: span.attributesJson,
  }
}

/** Hour angle is local sidereal time minus right ascension, wrapped into (-12, 12]. */
export function hourAngle(lstHours: number, raHours: number): number {
  const wrapped = (((lstHours - raHours) % 24) + 24) % 24

  return wrapped > 12 ? wrapped - 24 : wrapped
}

function linkKind<Target>(link: Link<Target> | null): LinkKind | null {
  return link?.kind ?? null
}

function candidates<Target>(link: Link<Target> | null, name: (target: Target) => string): string | null {
  return link?.kind === 'ambiguous' ? JSON.stringify(link.candidates.map(name)) : null
}
