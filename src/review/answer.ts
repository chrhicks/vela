import type Anthropic from '@anthropic-ai/sdk'
import { Data, Result, Schema } from 'effect'
import { ReviewAnswer, ReviewCause } from '../../state/review-answer.ts'

export class AnswerUnreadable extends Data.TaggedError('AnswerUnreadable')<{ readonly issue: string }> {}

const AnswerAsked = Schema.Struct({
  sees: Schema.String.annotate({ description: 'What the two pictures show, in at most three short sentences' }),
  cause: ReviewCause.annotate({
    description:
      'The most likely cause: obstruction is something blocking part of the sky such as trees, buildings or power lines; cloud is cloud or haze; focus is the focus having drifted; tracking-or-guiding is the mount or guiding; dew-or-frost is moisture on the optics; bright-sky-or-moon is a brighter sky; normal-variation is a change within what the run varies by; unknown is when the evidence does not decide',
  }),
  confidence: Schema.Finite.annotate({ description: 'How sure the cause is, from 0 to 1, lower when the evidence is thin' }),
  fix: Schema.String.annotate({ description: 'One concrete thing to try, or that nothing needs doing' }),
  line: Schema.String.annotate({ description: 'One short line in plain words for the run page, at most 100 characters' }),
})

const asked = Schema.toJsonSchemaDocument(AnswerAsked).schema

export const answerFormat: Anthropic.JSONOutputFormat = { type: 'json_schema', schema: { ...asked, additionalProperties: false } }

const decodeAnswerText = Schema.decodeUnknownResult(Schema.fromJsonString(ReviewAnswer))

export const decodeAnswer = (text: string): Result.Result<ReviewAnswer, AnswerUnreadable> => decodeAnswerText(text).pipe(Result.mapError(error => new AnswerUnreadable({ issue: error.message })))
