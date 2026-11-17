import { Effect, Schema } from 'effect'

import { FrameShape, frameShapeAddress, type Frame } from '../../../state/frames.ts'

const shapeOf = (frame: Pick<Frame, 'night' | 'file'>): Effect.Effect<FrameShape | null> =>
  Effect.tryPromise(() => fetch(frameShapeAddress(frame))).pipe(
    Effect.flatMap(response => Effect.tryPromise(() => response.json())),
    Effect.flatMap(Schema.decodeUnknownEffect(FrameShape)),
    Effect.catchTags({ UnknownError: () => Effect.succeed(null), SchemaError: () => Effect.succeed(null) }),
  )

export const frameShape = (frame: Pick<Frame, 'night' | 'file'>): Promise<FrameShape | null> => Effect.runPromise(shapeOf(frame))
