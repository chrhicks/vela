import { Context, Effect, Result } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http'
import type { NightName } from '../../state/entries.ts'
import { StackAsked, StackCropAsked, stackCropPath, stackPicturePath, stackShapePath } from '../../state/stack.ts'
import type { CropBox, CropOutside } from '../frames/crop.ts'

interface StackPicture {
  readonly png: Uint8Array
  readonly frames: number
}

export class StackPictures extends Context.Service<
  StackPictures,
  {
    readonly picture: (night: NightName, sequence: string) => Effect.Effect<StackPicture | undefined>
    readonly shape: (night: NightName, sequence: string) => Effect.Effect<{ readonly width: number; readonly height: number } | undefined>
    readonly crop: (night: NightName, sequence: string, box: CropBox) => Effect.Effect<Result.Result<StackPicture, CropOutside> | undefined>
  }
>()('vela/StackPictures') {}

const malformed = () => Effect.succeed(HttpServerResponse.empty({ status: 400 }))

const pictureResponse = (picture: StackPicture, frames: string | undefined) =>
  HttpServerResponse.uint8Array(picture.png, { contentType: 'image/png', headers: { 'cache-control': frames === String(picture.frames) ? 'public, max-age=31536000, immutable' : 'no-store' } })

export const StackPictureRoute = HttpRouter.add(
  'GET',
  stackPicturePath,
  Effect.gen(function* () {
    const pictures = yield* StackPictures
    const { night, sequence, frames } = yield* HttpServerRequest.schemaSearchParams(StackAsked)
    const picture = yield* pictures.picture(night, sequence)

    return picture === undefined ? HttpServerResponse.empty({ status: 404 }) : pictureResponse(picture, frames)
  }).pipe(Effect.catchTag('SchemaError', malformed)),
)

export const StackShapeRoute = HttpRouter.add(
  'GET',
  stackShapePath,
  Effect.gen(function* () {
    const pictures = yield* StackPictures
    const { night, sequence } = yield* HttpServerRequest.schemaSearchParams(StackAsked)
    const shape = yield* pictures.shape(night, sequence)

    return shape === undefined ? HttpServerResponse.empty({ status: 404 }) : HttpServerResponse.jsonUnsafe(shape, { headers: { 'cache-control': 'public, max-age=31536000, immutable' } })
  }).pipe(Effect.catchTag('SchemaError', malformed)),
)

export const StackCropRoute = HttpRouter.add(
  'GET',
  stackCropPath,
  Effect.gen(function* () {
    const pictures = yield* StackPictures
    const { night, sequence, frames, x, y, width, height } = yield* HttpServerRequest.schemaSearchParams(StackCropAsked)
    const crop = yield* pictures.crop(night, sequence, { x, y, width, height })

    if (crop === undefined) return HttpServerResponse.empty({ status: 404 })

    return Result.match(crop, { onFailure: () => HttpServerResponse.empty({ status: 400 }), onSuccess: picture => pictureResponse(picture, frames) })
  }).pipe(Effect.catchTag('SchemaError', malformed)),
)
