import { Context, Data, Effect, Result } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http'
import type { FrameFile, NightName } from '../../state/entries.ts'
import { CropAsked, frameCropPath, frameShapePath, PreviewAsked } from '../../state/frames.ts'
import { cropOf, type Developed } from '../frames/crop.ts'

export class FrameUndeveloped extends Data.TaggedError('FrameUndeveloped')<{ readonly night: NightName; readonly file: FrameFile; readonly cause: unknown }> {}

export class DevelopedFrames extends Context.Service<DevelopedFrames, { readonly get: (night: NightName, file: FrameFile) => Effect.Effect<Developed | undefined, FrameUndeveloped> }>()('vela/DevelopedFrames') {}

const kept = { 'cache-control': 'public, max-age=31536000, immutable' }

const notDeveloped = (failure: FrameUndeveloped) => Effect.as(Effect.logError(`could not read ${failure.night}/${failure.file} for a crop`, failure.cause), HttpServerResponse.empty({ status: 500 }))

export const FrameShapeRoute = HttpRouter.add(
  'GET',
  frameShapePath,
  Effect.gen(function* () {
    const frames = yield* DevelopedFrames
    const { night, file } = yield* HttpServerRequest.schemaSearchParams(PreviewAsked)
    const frame = yield* frames.get(night, file)

    return frame === undefined ? HttpServerResponse.empty({ status: 404 }) : HttpServerResponse.jsonUnsafe({ width: frame.width, height: frame.height }, { headers: kept })
  }).pipe(
    Effect.catchTag('SchemaError', () => Effect.succeed(HttpServerResponse.empty({ status: 400 }))),
    Effect.catchTag('FrameUndeveloped', notDeveloped),
  ),
)

export const FrameCropRoute = HttpRouter.add(
  'GET',
  frameCropPath,
  Effect.gen(function* () {
    const frames = yield* DevelopedFrames
    const { night, file, x, y, width, height } = yield* HttpServerRequest.schemaSearchParams(CropAsked)
    const frame = yield* frames.get(night, file)

    if (frame === undefined) return HttpServerResponse.empty({ status: 404 })

    return Result.match(cropOf(frame, { x, y, width, height }), {
      onFailure: () => HttpServerResponse.empty({ status: 400 }),
      onSuccess: png => HttpServerResponse.uint8Array(png, { contentType: 'image/png', headers: kept }),
    })
  }).pipe(
    Effect.catchTag('SchemaError', () => Effect.succeed(HttpServerResponse.empty({ status: 400 }))),
    Effect.catchTag('FrameUndeveloped', notDeveloped),
  ),
)
