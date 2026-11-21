import { Effect, Schema } from 'effect'
import { HorizonSweep, horizonSweepPath } from '../../../state/horizon-sweep.ts'
import type { MapReading } from '../../../state/horizon-sweep-view.ts'
import { asked, bodyOf } from './targets.ts'

const unreachable: Effect.Effect<MapReading> = Effect.succeed({ status: 'unreachable' })

const reading: Effect.Effect<MapReading> = asked(horizonSweepPath).pipe(
  Effect.flatMap(response => (response.ok ? bodyOf(response) : Effect.succeed(null))),
  Effect.flatMap(Schema.decodeUnknownEffect(HorizonSweep)),
  Effect.map((sweep): MapReading => ({ status: 'read', sweep })),
  Effect.catchTags({ UnknownError: () => unreachable, SchemaError: () => unreachable }),
)

export const horizonSweep = (): Promise<MapReading> => Effect.runPromise(reading)
