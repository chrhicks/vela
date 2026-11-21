import { Schema } from 'effect'

export const ReviewId = Schema.NonEmptyString.pipe(Schema.brand('ReviewId'))

export type ReviewId = typeof ReviewId.Type

const Fraction = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }))

export const ReviewAnswer = Schema.Struct({
  obstructed: Schema.Boolean,
  confidence: Fraction,
  hazard: Schema.NonEmptyString,
  what: Schema.String,
})

export type ReviewAnswer = typeof ReviewAnswer.Type

export const ReviewLineSource = Schema.Literals(['solve', 'mount'])

export type ReviewLineSource = typeof ReviewLineSource.Type

export const ReviewLine = Schema.Struct({
  centreDegrees: Schema.Finite,
  lowestDegrees: Schema.Finite,
  heightDegrees: Schema.Finite,
  source: ReviewLineSource,
})

export type ReviewLine = typeof ReviewLine.Type

export const ReviewFailureKind = Schema.Literals(['no-credential', 'rejected', 'no-credit', 'rate-limited', 'unreachable', 'refused', 'truncated', 'unreadable-answer', 'no-picture', 'restarted', 'other'])

export type ReviewFailureKind = typeof ReviewFailureKind.Type

export const ReviewFailure = Schema.Struct({ kind: ReviewFailureKind, message: Schema.String })

export type ReviewFailure = typeof ReviewFailure.Type

export const ReviewOutcome = Schema.Union([Schema.TaggedStruct('Answered', { answer: ReviewAnswer }), Schema.TaggedStruct('Failed', { failure: ReviewFailure })])

export type ReviewOutcome = typeof ReviewOutcome.Type

export const ReviewUsage = Schema.Struct({ inputTokens: Schema.Int, outputTokens: Schema.Int })

export type ReviewUsage = typeof ReviewUsage.Type

export const reviewPath = '/review'
