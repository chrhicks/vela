import { Context, Effect, Schema } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http'
import { NightName } from '../../state/entries.ts'
import { stackPicturePath } from '../../state/stack.ts'

export class StackPictures extends Context.Service<StackPictures, { readonly picture: (night: NightName, sequence: string) => Effect.Effect<Uint8Array | undefined> }>()('vela/StackPictures') {}

const StackAsked = Schema.Struct({ night: NightName, sequence: Schema.NonEmptyString, frames: Schema.optionalKey(Schema.String) })

export const StackPictureRoute = HttpRouter.add(
  'GET',
  stackPicturePath,
  Effect.gen(function* () {
    const pictures = yield* StackPictures
    const { night, sequence, frames } = yield* HttpServerRequest.schemaSearchParams(StackAsked)
    const png = yield* pictures.picture(night, sequence)

    return png === undefined
      ? HttpServerResponse.empty({ status: 404 })
      : HttpServerResponse.uint8Array(png, { contentType: 'image/png', headers: { 'cache-control': frames === undefined ? 'no-store' : 'public, max-age=31536000, immutable' } })
  }).pipe(Effect.catchTag('SchemaError', () => Effect.succeed(HttpServerResponse.empty({ status: 400 })))),
)
