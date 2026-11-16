import { Context, Effect, Layer } from 'effect'
import { HttpRouter, HttpServerResponse, HttpStaticServer } from 'effect/http'
import { detailSurveyPath, detailTilesPath, surveyPath, surveyTilesPath, type Survey } from '../../state/survey.ts'

interface Kept {
  readonly survey: Survey | null
  readonly tilesDir: string
}

export class SurveyKept extends Context.Service<SurveyKept, Kept>()('vela/SurveyKept') {}

export class DetailSurveyKept extends Context.Service<DetailSurveyKept, Kept>()('vela/DetailSurveyKept') {}

const surveyAnswer = ({ survey }: Kept) => HttpServerResponse.jsonUnsafe(survey, { headers: { 'cache-control': 'no-store' } })

const tilesFrom = (prefix: string) => ({ tilesDir }: Kept) => HttpStaticServer.layer({ root: tilesDir, prefix, cacheControl: 'public, max-age=31536000, immutable' })

export const SurveyRoute = HttpRouter.add('GET', surveyPath, Effect.map(SurveyKept, surveyAnswer))

export const SurveyTiles = Layer.unwrap(Effect.map(SurveyKept, tilesFrom(surveyTilesPath)))

export const DetailSurveyRoute = HttpRouter.add('GET', detailSurveyPath, Effect.map(DetailSurveyKept, surveyAnswer))

export const DetailSurveyTiles = Layer.unwrap(Effect.map(DetailSurveyKept, tilesFrom(detailTilesPath)))
