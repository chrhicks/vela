import type { MountSample, SavedImage, TraceSpan } from './inputs.ts'
import { linkFrameToSpan, linkMountAsOf, type Link, type MountLink } from './joins.ts'
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

/**
 * Joins the raw inputs of one session into table rows. Pure: the same inputs give the same rows.
 * The window picks the frames, and the mount and span rows that start inside it. Links look at
 * every input, so a frame at the start of the window still finds the mount sample just before it.
 * Such a link would join to nothing if its target were left out, so the rows a frame links to
 * are exported too, even when they fall before the window.
 */
export function buildTables(session: string, window: TimeWindow, inputs: SessionInputs): Tables {
  const inWindow = (time: Date) => window.from <= time && time < window.to
  const savedImages = inputs.savedImages.filter(image => inWindow(image.capturedAt))

  const frames = savedImages.map(image => {
    const spanLink = linkFrameToSpan(image, inputs.spans)
    const mount = linkMountAsOf(image.capturedAt, inputs.mountSamples, mountFreshSeconds)

    return { image, spanLink, mount }
  })

  const linkedSpans = new Set(frames.flatMap(({ spanLink }) => linkTargets(spanLink)))
  const linkedMountTimes = new Set(frames.flatMap(({ mount }) => linkTargets(mount?.link ?? null).map(time => time.getTime())))

  return {
    frames: frames.map(({ image, spanLink, mount }) => frameRow(session, image, spanLink, mount)),
    mount: inputs.mountSamples
      .filter(sample => inWindow(sample.sampledAt) || linkedMountTimes.has(sample.sampledAt.getTime()))
      .map(sample => mountRow(session, sample)),
    spans: inputs.spans.filter(span => inWindow(span.startedAt) || linkedSpans.has(span)).map(span => spanRow(session, span)),
  }
}

function linkTargets<Target>(link: Link<Target> | null): readonly Target[] {
  if (link === null) return []

  return link.kind === 'ambiguous' ? link.candidates : [link.target]
}

function frameRow(session: string, image: SavedImage, spanLink: Link<TraceSpan> | null, mount: MountLink | null): FrameRow {
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
