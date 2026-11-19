import { Schema } from 'effect'
import { described } from '../config.ts'

export const ReviewEffort = Schema.Literals(['low', 'medium', 'high', 'xhigh', 'max'])

export const ReviewSettings = Schema.Struct({
  enabled: described('Whether Vela asks the models below whether each light frame is obstructed. Needs a sign-in from `ant auth login`; without one each answer records that', Schema.Boolean, true),
  models: described('The models asked about every light frame, all with the same request at the same time, so their answers can be compared', Schema.Array(Schema.NonEmptyString), ['claude-opus-5-5', 'claude-haiku-5-5']),
  hazards: described('What can get in the way of the sky at the site, named in the question and offered to the models as the answer to which hazard it is; add the site\'s own', Schema.Array(Schema.NonEmptyString), ['trees', 'high-tension power poles/lines', 'houses', 'clouds obstructing stars']),
  answersFile: described('The JSON-lines file every ask and every answer is appended to, kept past the stream\'s 7 days', Schema.String, '/mnt/storage/vela/review.jsonl'),
  imageLongSide: described('The longest side, in pixels, of the picture sent with an ask', Schema.Int.check(Schema.isGreaterThan(0)), 1568),
  imageMaxBytes: described('The most bytes the picture sent with an ask may have; a larger one is made smaller until it fits', Schema.Int.check(Schema.isGreaterThan(0)), 4_500_000),
  effort: described('How much thinking effort the models are asked to put in', ReviewEffort, 'low'),
  maxTokens: described('The most tokens one answer, thinking included, may use', Schema.Int.check(Schema.isGreaterThan(0)), 16000),
})

export type ReviewSettings = typeof ReviewSettings.Type
