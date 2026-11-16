import { Schema } from 'effect'

export const surveyPath = '/sky-survey'

export const surveyTilesPath = '/sky-tiles'

export const detailSurveyPath = '/sky-detail-survey'

export const detailTilesPath = '/sky-detail-tiles'

export const Survey = Schema.Struct({
  name: Schema.String,
  credit: Schema.String,
  address: Schema.String,
  order: Schema.Int,
  tileWidth: Schema.Int,
  tiles: Schema.Int,
  pulledAt: Schema.String,
})

export type Survey = typeof Survey.Type

export const SurveyAnswer = Schema.NullOr(Survey)

export const tileCount = (order: number) => 12 * 4 ** order

export const tileFile = (order: number, tile: number) => `Norder${order}/Npix${tile}.jpg`
