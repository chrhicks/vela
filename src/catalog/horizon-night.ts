import { Data, Effect } from 'effect'
import { NightName } from '../../state/entries.ts'
import type { HorizonNight, HorizonRefusal } from '../../state/horizon-night.ts'
import { TargetId } from '../../state/targets.ts'
import { nightOf, type NightNaming } from '../frames/night.ts'
import type { Horizon } from '../horizon/horizon.ts'
import type { Site } from '../pointing/target.ts'
import { nightTimes } from '../sky/darkness.ts'
import { targetNight } from '../sky/target-night.ts'
import type { Catalog } from './catalog.ts'

export class HorizonNightRefused extends Data.TaggedError('HorizonNightRefused')<{ readonly refusal: HorizonRefusal }> {}

export interface HorizonNightSettings {
  readonly stepSeconds: number
  readonly decimals: number
  readonly upLineDegrees: number
}

export interface HorizonNightOptions {
  readonly catalog: Catalog
  readonly site: () => Site | undefined
  readonly horizon: Horizon
  readonly horizonFileLoaded: boolean
  readonly meridianLimitDegrees: () => number | undefined
  readonly naming: NightNaming
  readonly settings: HorizonNightSettings
}

const sweepNightsOf = (horizon: Horizon): ReadonlyArray<NightName> =>
  [...new Set(horizon.origins.flatMap(origin => (origin === null ? [] : [origin.night])))].sort()

export function makeHorizonNights({ catalog, site, horizon, horizonFileLoaded, meridianLimitDegrees, naming, settings }: HorizonNightOptions) {
  const line = { horizon, upLineDegrees: settings.upLineDegrees }

  return {
    night: (id: string, at: number): Effect.Effect<HorizonNight, HorizonNightRefused> =>
      Effect.gen(function* () {
        const target = catalog.find(id)

        if (target === undefined) return yield* Effect.fail(new HorizonNightRefused({ refusal: { code: 'unknown-target', text: id } }))

        const here = site()

        if (here === undefined) return yield* Effect.fail(new HorizonNightRefused({ refusal: { code: 'no-site' } }))

        const night = nightTimes(here, at)

        if (night === undefined) return yield* Effect.fail(new HorizonNightRefused({ refusal: { code: 'no-night' } }))

        const { path, clear, facts } = targetNight({ target, site: here, night, at, line, stepSeconds: settings.stepSeconds, decimals: settings.decimals, meridianLimitDegrees: meridianLimitDegrees() })

        return {
          target: { id: TargetId.make(target.id), name: target.name, commonName: target.commonName },
          at,
          night: NightName.make(nightOf(night.duskAt, naming)),
          zone: naming.zone,
          times: { duskAt: night.duskAt, darkAt: night.darkAt ?? null, darkEndsAt: night.darkEndsAt ?? null, dawnAt: night.dawnAt },
          horizon: { fileLoaded: horizonFileLoaded, altitudesDegrees: horizon.altitudesDegrees, sources: horizon.sources, sweepNights: sweepNightsOf(horizon), upLineDegrees: settings.upLineDegrees },
          path,
          clear,
          facts,
        }
      }),
  }
}
