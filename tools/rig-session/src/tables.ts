import type { MountSample, SavedImage, TraceSpan } from './inputs.ts'
import { linkFrameToSpan, linkMountAsOf, type Link } from './joins.ts'
import type { FrameRow, LinkKind, MountRow, SpanRow, Tables } from './schema.ts'

export interface TimeWindow {
  readonly from: Date
  readonly to: Date
}

export interface SessionInputs {
  readonly savedImages: readonly SavedImage[]
  readonly spans: readonly TraceSpan[]
  readonly mountSamples: readonly MountSample[]
}

/** The CSV logs every 10 seconds. A sample three times older than that has missed its beat. */
export const mountFreshSeconds = 30

/** Joins the raw inputs of one session into table rows. Pure: the same inputs give the same rows. */
export function buildTables(session: string, window: TimeWindow, inputs: SessionInputs): Tables {
  const inWindow = (time: Date) => window.from <= time && time < window.to
  const spans = inputs.spans.filter(span => inWindow(span.startedAt))
  const mountSamples = inputs.mountSamples.filter(sample => inWindow(sample.sampledAt))
  const savedImages = inputs.savedImages.filter(image => inWindow(image.capturedAt))

  return {
    frames: savedImages.map(image => frameRow(session, image, spans, mountSamples)),
    mount: mountSamples.map(sample => mountRow(session, sample)),
    spans: spans.map(span => spanRow(session, span)),
  }
}

function frameRow(
  session: string,
  image: SavedImage,
  spans: readonly TraceSpan[],
  mountSamples: readonly MountSample[],
): FrameRow {
  const spanLink = linkFrameToSpan(image, spans)
  const mount = linkMountAsOf(image.capturedAt, mountSamples, mountFreshSeconds)
  const span = spanLink?.kind === 'ambiguous' ? null : (spanLink?.target ?? null)
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
    detected_stars: image.detectedStars,
    median_hfr_px: image.medianHfrPixels,
    saved_dir: image.directory,
    span_id: span?.spanId ?? null,
    span_link: linkKind(spanLink),
    span_candidates: candidates(spanLink, candidate => candidate.spanId),
    run_frame_index: span?.captureFrame?.index ?? null,
    mount_sampled_at: mountLink?.kind === 'ambiguous' ? null : (mountLink?.target ?? null),
    mount_link: linkKind(mountLink),
    mount_candidates: candidates(mountLink, candidate => candidate.toISOString()),
    mount_age_seconds: mount?.ageSeconds ?? null,
  }
}

function mountRow(session: string, sample: MountSample): MountRow {
  return {
    session,
    sampled_at: sample.sampledAt,
    ra_hours: sample.raHours,
    dec_degrees: sample.decDegrees,
    lst_hours: sample.lstHours,
    hour_angle_hours: hourAngle(sample.lstHours, sample.raHours),
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
