import { z } from 'zod'
import type { HorizonProfile } from '@vela/server/targets/horizon'

/** The survey file's fields this tool reads. Others (wires, sources, metadata) are ignored. */
const surveySchema = z.object({
  stepDeg: z.number().positive(),
  samples: z
    .array(
      z.object({
        az: z.number().finite(),
        smooth: z.number().finite().nullable().optional(),
        supported: z.boolean().optional(),
      }),
    )
    .min(1),
})

export interface ConvertOptions {
  azimuthOffsetDegrees: number
  altitudeOffsetDegrees: number
  stepDegrees: number
  importedAt: Date
}

export interface Conversion {
  profile: HorizonProfile
  traced: number
  unknown: number
}

const wrap = (degrees: number) => ((degrees % 360) + 360) % 360

/**
 * Survey azimuth plus the offset picks the output bin. A bin keeps the highest smoothed
 * altitude of its samples plus the altitude offset, floored at 0. It is unknown when it has
 * no sample or any sample is unsupported: an untraced stretch is never read as open sky.
 */
export function convertSurvey(survey: unknown, options: ConvertOptions): Conversion {
  const { stepDegrees, azimuthOffsetDegrees, altitudeOffsetDegrees } = options
  const bins = Math.round(360 / stepDegrees)

  if (!(stepDegrees > 0) || Math.abs(bins * stepDegrees - 360) > 1e-9)
    throw new RangeError('The step must divide 360 degrees evenly.')

  if (!Number.isFinite(azimuthOffsetDegrees) || !Number.isFinite(altitudeOffsetDegrees))
    throw new RangeError('Both offsets must be finite numbers.')

  const { samples } = surveySchema.parse(survey)
  const highest: Array<number | null> = Array.from({ length: bins }, () => null)
  const untraced = new Set<number>()

  for (const sample of samples) {
    const bin = Math.floor(wrap(sample.az + azimuthOffsetDegrees) / stepDegrees) % bins

    if (sample.supported !== true || sample.smooth == null) {
      untraced.add(bin)
      continue
    }

    highest[bin] = Math.max(highest[bin] ?? -Infinity, sample.smooth)
  }

  const altitudesDegrees = highest.map((altitude, bin) =>
    altitude === null || untraced.has(bin)
      ? null
      : Math.min(90, Math.max(0, altitude + altitudeOffsetDegrees)),
  )

  const traced = altitudesDegrees.filter(altitude => altitude !== null).length

  return {
    profile: {
      version: 1,
      approximate: true,
      note:
        'Approximate. Traced from a photo survey with azimuth and altitude offsets from one Sun sighting. ' +
        'The survey north is not demonstrated true north. A null bin was not traced: unknown, not open sky.',
      importedAt: options.importedAt.toISOString(),
      offsets: { azimuthDegrees: azimuthOffsetDegrees, altitudeDegrees: altitudeOffsetDegrees },
      stepDegrees,
      altitudesDegrees,
    },
    traced,
    unknown: bins - traced,
  }
}
