import { Effect, Schema } from 'effect'
import { HorizonNight, HorizonRefusal, horizonNightPath } from '../../../state/horizon-night.ts'
import { asked, bodyOf } from './targets.ts'

export type NightReading =
  | { readonly status: 'night'; readonly night: HorizonNight }
  | { readonly status: 'refused'; readonly refusal: HorizonRefusal }
  | { readonly status: 'unreachable' }

const unreachable: Effect.Effect<NightReading> = Effect.succeed({ status: 'unreachable' })

const reading = (target: string): Effect.Effect<NightReading> =>
  asked(`${horizonNightPath}?${new URLSearchParams({ target })}`).pipe(
    Effect.flatMap(response =>
      bodyOf(response).pipe(
        Effect.flatMap(body =>
          response.ok
            ? Schema.decodeUnknownEffect(HorizonNight)(body).pipe(Effect.map((night): NightReading => ({ status: 'night', night })))
            : Schema.decodeUnknownEffect(HorizonRefusal)(body).pipe(Effect.map((refusal): NightReading => ({ status: 'refused', refusal }))),
        ),
      ),
    ),
    Effect.catchTags({ UnknownError: () => unreachable, SchemaError: () => unreachable }),
  )

export const horizonNight = (target: string): Promise<NightReading> => Effect.runPromise(reading(target))
