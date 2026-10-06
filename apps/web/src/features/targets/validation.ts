import { z } from 'zod'
import type {
  FramingView,
  TargetCatalogView,
  TargetDiscoveryView,
  TargetPosition,
  TargetView,
  TargetsView,
} from '@vela/model/web'

const date = z.string().refine(value => Number.isFinite(Date.parse(value)))

const position = z.object({
  raDegrees: z.number().min(0).lt(360),
  decDegrees: z.number().min(-90).max(90),
})

const horizontal = z.object({
  azimuthDegrees: z.number().min(0).lt(360),
  altitudeDegrees: z.number().min(-90).max(90),
})

const moon = horizontal.extend({
  illuminationFraction: z.number().min(0).max(1),
  waxing: z.boolean(),
})

const window = z.object({ startsAt: date, endsAt: date })

const sky = z
  .object({
    observedAt: date,
    startsAt: date,
    endsAt: date,
    currentMoonSeparationDegrees: z.number().min(0).max(180),
    currentAzimuthDegrees: z.number().min(0).lt(360),
    currentAltitudeDegrees: z.number(),
    highestAltitudeDegrees: z.number(),
    samples: z.array(horizontal.extend({ at: date, moon, sunAltitudeDegrees: z.number() })).min(2),
    aboveHorizonDuringDarkness: z.array(window),
  })
  .refine(value => {
    const start = Date.parse(value.startsAt)
    const duration = Date.parse(value.endsAt) - start
    const interval = duration / (value.samples.length - 1)

    return (
      duration > 0 &&
      value.samples.every(
        (sample, index) => Math.abs(Date.parse(sample.at) - (start + index * interval)) < 1,
      )
    )
  })

const target = position.extend({
  id: z.string(),
  name: z.string(),
  catalog: z.string(),
  kind: z.string(),
  constellation: z.string().trim().min(1).nullable(),
  sizeArcminutes: z.number().positive().nullable(),
  minorSizeArcminutes: z.number().positive().nullable(),
  thumbnailUrl: z.string().startsWith('/api/'),
  sky: sky.nullable(),
})

const targets = z.object({
  rigId: z.string(),
  rigName: z.string(),
  targets: z.array(target),
  total: z.number().nonnegative(),
  siteUnavailableReason: z.string().nullable(),
  site: z.object({ latitudeDegrees: z.number(), longitudeDegrees: z.number() }).nullable(),
})

const category = z.enum(['emission', 'reflection-dark', 'galaxy', 'cluster', 'planetary', 'other'])

const filter = z.enum(['dual-band', 'broadband', 'uncertain'])

const discovery = targets.extend({
  snapshotId: z.string(),
  calculatedAt: date,
  status: z.enum(['available', 'site-unavailable', 'no-darkness']),
  query: z.string(),
  category: z.union([z.literal('all'), category]),
  filter: z.union([z.literal('all'), filter]),
  offset: z.number().refine(Number.isInteger).nonnegative(),
  pageSize: z.number().refine(Number.isInteger).positive(),
  night: window.nullable(),
  targets: z.array(
    target.extend({
      category,
      filterChoice: filter,
      filterReason: z.string(),
      opportunity: window
        .extend({
          bestAt: date,
          usefulMinutes: z.number().positive(),
          bestAltitudeDegrees: z.number(),
          currentAltitudeDegrees: z.number(),
        })
        .nullable(),
    }),
  ),
})

const catalog = z.object({
  query: z.string(),
  category: z.union([z.literal('all'), category]),
  filter: z.union([z.literal('all'), filter]),
  offset: z.number().int().nonnegative(),
  pageSize: z.number().int().min(1).max(12),
  total: z.number().int().nonnegative(),
  targets: z.array(target.omit({ sky: true }).extend({
    category, filterChoice: filter, filterReason: z.string(),
  }).strict()),
}).strict()

const preview = z.object({
  id: z.string().min(1),
  rigId: z.string().min(1),
  targetId: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  exposureSeconds: z.number().positive(),
  cameraName: z.string().min(1),
  capturedAt: date,
  capturedAtSource: z.enum(['camera', 'server-estimate']),
  checkId: z.string().min(1).nullable(),
  previewUrl: z.string().startsWith('/api/').nullable(),
  nativePreviewUrl: z.string().startsWith('/api/').nullable(),
  statistics: z.object({
    detectedStars: z.number().int().nonnegative(),
    medianHfrPixels: z.number().positive().nullable(),
  }).nullable(),
}).refine(value => (value.previewUrl === null) === (value.nativePreviewUrl === null))

const pointingSide = z.enum(['east', 'west', 'unknown'])

const centering = z
  .object({
    toleranceArcminutes: z.number().positive(),
    maxCorrections: z.number().int().positive(),
    correction: z.number().int().nonnegative(),
    outcome: z.enum(['working', 'centered', 'not-converging', 'limit-reached', 'interrupted']),
    measurements: z.array(
      z.object({
        correction: z.number().int().nonnegative(),
        checkId: z.string().min(1),
        capturedAt: date,
        offsetArcminutes: z.number().nonnegative(),
        rotationDegrees: z.number(),
        pointingSide,
        pointingSideChanged: z.boolean(),
        trend: z.enum(['starting', 'improved', 'worsened', 'unchanged', 'within-tolerance']),
      }),
    ),
  })
  .refine(
    value =>
      value.correction <= value.maxCorrections &&
      value.measurements.length <= value.maxCorrections + 2 &&
      value.measurements.every(sample => sample.correction <= value.correction),
  )

const framing = z
  .object({
    captureReadState: z.enum(['current', 'retrying']),
    rigId: z.string(),
    rigName: z.string(),
    enabled: z.boolean(),
    mountControlReason: z.enum(['parked', 'tracking-off']).optional(),
    active: z.boolean(),
    canCenter: z.boolean(),
    checkCurrent: z.boolean(),
    observedAt: date,
    error: z.string().nullable(),
    unavailableReason: z.string().nullable(),
    targetId: z.string().nullable(),
    exposureSeconds: z.number(),
    phase: z.enum([
      'idle',
      'slewing',
      'settling',
      'needs-check',
      'exposing',
      'downloading',
      'solving',
      'checked',
      'stopping',
      'stopped',
      'failed',
    ]),
    pointingSide,
    centering: centering.nullable(),
    focalLengthMm: z.number().positive().nullable(),
    desired: position.nullable(),
    camera: z
      .object({
        name: z.string(),
        width: z.number().positive(),
        height: z.number().positive(),
        fieldWidthDegrees: z.number().positive(),
        fieldHeightDegrees: z.number().positive(),
      })
      .nullable(),
    preview: preview.nullable(),
    actual: position
      .extend({
        checkId: z.string().min(1),
        capturedAt: date,
        rotationDegrees: z.number(),
        offsetArcminutes: z.number(),
        corners: z.array(position).length(4),
      })
      .nullable(),
  })
  .refine(value => value.centering === null || (value.desired !== null && !!value.targetId))
  .refine(value => value.preview === null ||
    (value.preview.rigId === value.rigId && value.preview.targetId === value.targetId))

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

export function isTargetCatalog(value: unknown): value is TargetCatalogView {
  return catalog.safeParse(value).success
}
