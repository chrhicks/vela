import { minimumFixes } from '@vela/rig-sky'
import { z } from 'zod'

export const diagnosticJournalName = 'journal.jsonl'

export const maximumJournalBytes = 4 * 1024 * 1024

export const maximumFitsBytes = 128 * 1024 * 1024

/** The most sweep positions a trial records, kept or dropped. */
export const maximumFixes = 16

const number = z.number().finite()

const positiveInteger = number.int().positive().safe()

const timestamp = z.string().datetime({ offset: true })

const ra = number.min(0).lt(360)

const dec = number.min(-90).max(90)

const position = z.object({ raDegrees: ra, decDegrees: dec })

const sample = position.extend({ capturedAt: timestamp, siderealTimeDegrees: ra })

const measurement = z.object({
  altitudeArcsec: number,
  azimuthArcsec: number,
  totalArcsec: number.nonnegative(),
  correctionTarget: position,
})

const rigidity = z.object({
  status: z.enum(['rigid', 'not-rigid']),
  missArcmin: number.nonnegative(),
  thresholdArcmin: number.positive(),
})

const step = z.object({
  labelBefore: z.string(),
  labelAfter: z.string(),
  excessArcmin: number.nonnegative(),
  baselineArcmin: number.nonnegative(),
  turnDegrees: number,
  mountAngleBeforeDegrees: number,
  mountAngleAfterDegrees: number,
})

export const droppedReasons = ['no-solve', 'rejected', 'capture-failed'] as const

export type DroppedReason = (typeof droppedReasons)[number]

const site = z.object({
  latitudeDegrees: dec,
  longitudeDegrees: number.min(-180).max(180),
  elevationMeters: number.optional(),
})

const coordinateSystem = z.enum(['other', 'topocentric', 'j2000', 'j2050', 'b1950'])

const mount = z.object({
  rightAscensionDegrees: ra,
  declinationDegrees: dec,
  coordinateSystem: z.union([coordinateSystem, z.literal('unknown')]),
  latitudeDegrees: dec.optional(),
  longitudeDegrees: number.min(-180).max(180).optional(),
  elevationMeters: number.optional(),
  tracking: z.boolean(),
  trackingRate: z.enum(['sidereal', 'lunar', 'solar', 'king']).optional(),
  rightAscensionRateSecondsPerSiderealSecond: number.optional(),
  declinationRateArcsecondsPerSecond: number.optional(),
  pierSide: z.enum(['east', 'west', 'unknown']).optional(),
  slewing: z.boolean(),
  parked: z.boolean(),
  observedAt: timestamp,
})

const camera = z.object({
  cameraName: z.string().min(1),
  sensorWidthPixels: positiveInteger,
  sensorHeightPixels: positiveInteger,
  pixelWidthMicrons: number.positive(),
  pixelHeightMicrons: number.positive(),
  binX: positiveInteger,
  binY: positiveInteger,
  width: positiveInteger,
  height: positiveInteger,
  startX: number.int().nonnegative(),
  startY: number.int().nonnegative(),
})

const pointing = z.object({
  rightAscensionDegrees: ra,
  declinationDegrees: dec,
  siderealTimeDegrees: ra,
  latitudeDegrees: dec,
  tracking: z.boolean(),
  coordinateSystem,
})

export const diagnosticRunInfoSchema = z.object({
  runId: z.string().uuid(),
  rigId: z.string().min(1),
  rigName: z.string().min(1),
  mode: z.enum(['offline', 'physical']),
  cameraId: z.string().min(1),
  telescopeId: z.string().min(1),
  cameraName: z.string().min(1),
  exposureSeconds: number.positive(),
})

const frameEntry = z.object({
  type: z.literal('frame'),
  original: z.object({
    filename: z.string().regex(/^(baseline|adjusting)-[0-9a-f-]{36}\.fits$/),
    bytes: positiveInteger.max(maximumFitsBytes),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  capture: z.object({
    width: positiveInteger,
    height: positiveInteger,
    capturedAt: timestamp,
    capturedAtSource: z.enum(['camera', 'server-estimate']),
    color: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('mono') }),
      z.object({ kind: z.literal('bayer'), pattern: z.enum(['rggb', 'grbg', 'gbrg', 'bggr']) }),
    ]),
  }),
  evidence: z.object({
    phase: z.enum(['baseline', 'adjusting']),
    position: positiveInteger.max(maximumFixes),
    solution: position.extend({
      status: z.literal('solved'),
      capturedAt: timestamp,
      wcs: position
        .extend({
          width: positiveInteger,
          height: positiveInteger,
          referenceX: number,
          referenceY: number,
          cd: z.tuple([number, number, number, number]).readonly(),
        })
        .refine(wcs => wcs.cd[0] * wcs.cd[3] - wcs.cd[1] * wcs.cd[2] !== 0, 'Singular WCS'),
    }),
    sample,
    hint: position,
    fieldHeightDegrees: number.positive().max(90),
    physical: z.object({ site, camera, before: mount, after: mount }).optional(),
    offlinePointing: pointing.optional(),
  }),
})

export const diagnosticEntrySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('run'),
    schemaVersion: z.literal(1),
    createdAt: timestamp,
    run: diagnosticRunInfoSchema,
  }),
  frameEntry,
  /** Read only: the three-point journals of before plan step 34b. Nothing writes this entry now. */
  z.object({
    type: z.literal('baseline'),
    samples: z.tuple([sample, sample, sample]).readonly(),
    latitudeDegrees: number.gt(0).lt(85),
    measurement,
    rigidity: rigidity.optional(),
  }),
  z.object({
    type: z.literal('fit'),
    latitudeDegrees: number.gt(0).lt(85),
    /** The fixes the fit used, in sweep order. Each is the sample of the `baseline` frame at that position. */
    fixes: z.array(z.object({ position: positiveInteger.max(maximumFixes), sample })).min(minimumFixes).max(maximumFixes),
    /** The axis in the hour-angle frame (z up) and its error; null unless the verdict is rigid. */
    polar: z
      .object({
        axis: z.tuple([number, number, number]),
        altitudeArcsec: number,
        azimuthArcsec: number,
        totalArcsec: number.nonnegative(),
      })
      .nullable(),
    verdict: rigidity.extend({ steps: z.array(step) }),
  }),
  z.object({
    type: z.literal('dropped'),
    position: positiveInteger.max(maximumFixes),
    reason: z.enum(droppedReasons),
    detail: z.string().max(500).nullable(),
  }),
  z.object({
    type: z.literal('measurement'),
    sample,
    measurement,
    tracking: z.literal(true),
    mount: mount.optional(),
  }),
  z.object({
    type: z.literal('outcome'),
    phase: z.enum(['finished', 'stopped', 'failed']),
    error: z.string().nullable(),
  }),
])

export type DiagnosticEntry = z.infer<typeof diagnosticEntrySchema>

export type DiagnosticFrameEntry = z.infer<typeof frameEntry>
