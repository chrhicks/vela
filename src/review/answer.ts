import type Anthropic from '@anthropic-ai/sdk'
import { Data, Result, Schema } from 'effect'
import { ReviewAnswer } from '../../state/review-answer.ts'

export class AnswerUnreadable extends Data.TaggedError('AnswerUnreadable')<{ readonly issue: string }> {}

export const noHazard = 'none'

export const otherHazard = 'other'

export const hazardChoices = (hazards: ReadonlyArray<string>): ReadonlyArray<string> => [...new Set([...hazards, noHazard, otherHazard])]

const answerFor = (hazards: ReadonlyArray<string>) =>
  Schema.Struct({
    obstructed: Schema.Boolean.annotate({ description: 'Whether something is in the way of the sky in this frame' }),
    confidence: Schema.Finite.annotate({ description: 'How sure obstructed is right, from 0 to 1' }),
    hazard: Schema.Literals(hazardChoices(hazards)).annotate({ description: `Which hazard it is, ${noHazard} when the frame is clear, ${otherHazard} when it is something not listed` }),
    what: Schema.String.annotate({ description: 'One short sentence on what the frame shows' }),
  })

export const answerFormat = (hazards: ReadonlyArray<string>): Anthropic.JSONOutputFormat => ({
  type: 'json_schema',
  schema: { ...Schema.toJsonSchemaDocument(answerFor(hazards)).schema, additionalProperties: false },
})

export const decodeAnswer = (hazards: ReadonlyArray<string>) => {
  const decode = Schema.decodeUnknownResult(Schema.fromJsonString(answerFor(hazards)))
  const inRange = Schema.decodeUnknownResult(ReviewAnswer)

  return (text: string): Result.Result<ReviewAnswer, AnswerUnreadable> =>
    decode(text).pipe(
      Result.flatMap(inRange),
      Result.mapError(error => new AnswerUnreadable({ issue: error.message })),
    )
}
