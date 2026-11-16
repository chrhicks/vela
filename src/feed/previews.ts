import { Context, Data, Effect } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http'
import type { FrameFile, NightName } from '../../state/entries.ts'
import { PreviewAsked, previewPath } from '../../state/frames.ts'

export class PreviewFailed extends Data.TaggedError('PreviewFailed')<{ readonly night: NightName; readonly file: FrameFile; readonly cause: unknown }> {}

export class Previews extends Context.Service<Previews, { readonly get: (night: NightName, file: FrameFile) => Effect.Effect<Uint8Array | undefined, PreviewFailed> }>()('vela/Previews') {}

export const PreviewRoute = HttpRouter.add(
  'GET',
  previewPath,
  Effect.gen(function* () {
    const previews = yield* Previews
    const { night, file } = yield* HttpServerRequest.schemaSearchParams(PreviewAsked)
    const png = yield* previews.get(night, file)

    return png === undefined ? HttpServerResponse.empty({ status: 404 }) : HttpServerResponse.uint8Array(png, { contentType: 'image/png', headers: { 'cache-control': 'public, max-age=31536000, immutable' } })
  }).pipe(
    Effect.catchTag('SchemaError', () => Effect.succeed(HttpServerResponse.empty({ status: 400 }))),
    Effect.catchTag('PreviewFailed', failure => Effect.as(Effect.logError(`could not make the preview of ${failure.night}/${failure.file}`, failure.cause), HttpServerResponse.empty({ status: 500 }))),
  ),
)
