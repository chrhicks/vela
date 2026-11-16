import { Context, Effect } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http'
import type { FrameFile, NightName } from '../../state/entries.ts'
import { PreviewAsked, previewPath } from '../../state/frames.ts'

export class Previews extends Context.Service<Previews, { readonly get: (night: NightName, file: FrameFile) => Effect.Effect<Uint8Array | undefined> }>()('vela/Previews') {}

export const PreviewRoute = HttpRouter.add(
  'GET',
  previewPath,
  Effect.gen(function* () {
    const previews = yield* Previews
    const { night, file } = yield* HttpServerRequest.schemaSearchParams(PreviewAsked)
    const png = yield* previews.get(night, file)

    return png === undefined ? HttpServerResponse.empty({ status: 404 }) : HttpServerResponse.uint8Array(png, { contentType: 'image/png', headers: { 'cache-control': 'public, max-age=31536000, immutable' } })
  }).pipe(Effect.catchTag('SchemaError', () => Effect.succeed(HttpServerResponse.empty({ status: 400 })))),
)
