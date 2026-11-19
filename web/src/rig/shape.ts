import { Effect, Schema } from 'effect'

import { FrameShape } from '../../../state/frames.ts'

const shapeOf = (address: string): Effect.Effect<FrameShape | null> =>
  Effect.tryPromise(() => fetch(address)).pipe(
    Effect.filterOrFail(response => response.ok),
    Effect.flatMap(response => Effect.tryPromise(() => response.json())),
    Effect.flatMap(Schema.decodeUnknownEffect(FrameShape)),
    Effect.catch(() => Effect.succeed(null)),
  )

export const shapeAt = (address: string): Promise<FrameShape | null> => Effect.runPromise(shapeOf(address))
