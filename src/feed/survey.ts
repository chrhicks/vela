import { Context, Effect, Layer } from 'effect'
import { HttpRouter, HttpServerResponse, HttpStaticServer } from 'effect/http'
import { surveyPath, surveyTilesPath, type Survey } from '../../state/survey.ts'

export class SurveyKept extends Context.Service<SurveyKept, { readonly survey: Survey | null; readonly tilesDir: string }>()('vela/SurveyKept') {}

export const SurveyRoute = HttpRouter.add(
  'GET',
  surveyPath,
  Effect.map(SurveyKept, ({ survey }) => HttpServerResponse.jsonUnsafe(survey, { headers: { 'cache-control': 'no-store' } })),
)

export const SurveyTiles = Layer.unwrap(Effect.map(SurveyKept, ({ tilesDir }) => HttpStaticServer.layer({ root: tilesDir, prefix: surveyTilesPath, cacheControl: 'public, max-age=31536000, immutable' })))
