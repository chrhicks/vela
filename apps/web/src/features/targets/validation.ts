import { z } from 'zod'
import type { FramingView, TargetDiscoveryView, TargetPosition, TargetView, TargetsView } from '@vela/model/web'

const date = z.string().refine(value => Number.isFinite(Date.parse(value)))

const position = z.object({ raDegrees: z.number().min(0).lt(360), decDegrees: z.number().min(-90).max(90) })

const horizontal = z.object({ azimuthDegrees: z.number().min(0).lt(360), altitudeDegrees: z.number().min(-90).max(90) })

const moon = horizontal.extend({ illuminationFraction: z.number().min(0).max(1), waxing: z.boolean() })

const window = z.object({ startsAt: date, endsAt: date })

const sky = z.object({
  observedAt: date,
  startsAt: date,
  endsAt: date,
  currentAltitudeDegrees: z.number(),
  highestAltitudeDegrees: z.number(),
  samples: z.array(horizontal.extend({ at: date, moon, sunAltitudeDegrees: z.number() })).min(2),
  aboveHorizonDuringDarkness: z.array(window),
}).refine(value => {
  const start = Date.parse(value.startsAt)
  const duration = Date.parse(value.endsAt) - start
  const interval = duration / (value.samples.length - 1)

  return duration > 0 && value.samples.every((sample, index) => Math.abs(Date.parse(sample.at) - (start + index * interval)) < 1)
})

const target = position.extend({
  id: z.string(), name: z.string(), catalog: z.string(), kind: z.string(),
  sizeArcminutes: z.number().nullable(),
  thumbnailUrl: z.string().startsWith('/api/'),
  sky: sky.nullable(),
})

const targets = z.object({
  rigId: z.string(), rigName: z.string(), targets: z.array(target), total: z.number().nonnegative(),
  siteUnavailableReason: z.string().nullable(),
  site: z.object({ latitudeDegrees: z.number(), longitudeDegrees: z.number() }).nullable(),
})

const category = z.enum(['emission', 'reflection-dark', 'galaxy', 'cluster', 'planetary', 'other'])

const filter = z.enum(['dual-band', 'broadband', 'uncertain'])

const discovery = targets.extend({
  snapshotId: z.string(), calculatedAt: date,
  status: z.enum(['available', 'site-unavailable', 'no-darkness']),
  query: z.string(), category: z.union([z.literal('all'), category]), filter: z.union([z.literal('all'), filter]),
  offset: z.number().refine(Number.isInteger).nonnegative(), pageSize: z.number().refine(Number.isInteger).positive(), night: window.nullable(),
  targets: z.array(target.extend({
    category, filterChoice: filter, filterReason: z.string(),
    opportunity: window.extend({
      bestAt: date, usefulMinutes: z.number().positive(), bestAltitudeDegrees: z.number(), currentAltitudeDegrees: z.number(),
    }).nullable(),
  })),
})

const framing = z.object({
  rigId: z.string(), rigName: z.string(), enabled: z.boolean(), active: z.boolean(), canCenter: z.boolean(), checkCurrent: z.boolean(),
  observedAt: date, error: z.string().nullable(), unavailableReason: z.string().nullable(), targetId: z.string().nullable(), exposureSeconds: z.number(),
  phase: z.enum(['idle', 'slewing', 'settling', 'needs-check', 'exposing', 'solving', 'checked', 'stopping', 'stopped', 'failed']),
  focalLengthMm: z.number().positive().nullable(), desired: position.nullable(),
  camera: z.object({ name: z.string(), width: z.number().positive(), height: z.number().positive(), fieldWidthDegrees: z.number().positive(), fieldHeightDegrees: z.number().positive() }).nullable(),
  actual: position.extend({ checkId: z.string().min(1), capturedAt: date, rotationDegrees: z.number(), offsetArcminutes: z.number(), corners: z.array(position).length(4) }).nullable(),
})

export function isPosition(value: unknown): value is TargetPosition {
  return position.safeParse(value).success
}

export function isTarget(value: unknown): value is TargetView {
  return target.safeParse(value).success
}

export function isTargets(value: unknown, rigId: string): value is TargetsView {
  const result = targets.safeParse(value)

  return result.success && result.data.rigId === rigId
}

export function isTargetDiscovery(value: unknown, rigId: string): value is TargetDiscoveryView {
  const result = discovery.safeParse(value)

  return result.success && result.data.rigId === rigId
}

export function isFramingView(value: unknown, rigId: string): value is FramingView {
  const result = framing.safeParse(value)

  return result.success && result.data.rigId === rigId
}
