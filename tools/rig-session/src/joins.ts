import type { MountSample, SavedImage, TraceSpan } from './inputs.ts'

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
