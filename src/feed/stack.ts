import { Context, Effect, Schema } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http'
import { NightName } from '../../state/entries.ts'
import { stackPicturePath } from '../../state/stack.ts'

export class StackPictures extends Context.Service<StackPictures, { readonly picture: (night: NightName, sequence: string) => Effect.Effect<{ readonly png: Uint8Array; readonly frames: number } | undefined> }>()('vela/StackPictures') {}

const StackAsked = Schema.Struct({ night: NightName, sequence: Schema.NonEmptyString, frames: Schema.optionalKey(Schema.String) })

export const StackPictureRoute = HttpRouter.add(
  'GET',
  stackPicturePath,
  Effect.gen(function* () {
    const pictures = yield* StackPictures
    const { night, sequence, frames } = yield* HttpServerRequest.schemaSearchParams(StackAsked)
    const picture = yield* pictures.picture(night, sequence)

    return picture === undefined
      ? HttpServerResponse.empty({ status: 404 })
      : HttpServerResponse.uint8Array(picture.png, { contentType: 'image/png', headers: { 'cache-control': frames === String(picture.frames) ? 'public, max-age=31536000, immutable' : 'no-store' } })
  }).pipe(Effect.catchTag('SchemaError', () => Effect.succeed(HttpServerResponse.empty({ status: 400 })))),
)
