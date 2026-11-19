import { Schema } from 'effect'

export const ReviewId = Schema.NonEmptyString.pipe(Schema.brand('ReviewId'))

export type ReviewId = typeof ReviewId.Type

export const ReviewCause = Schema.Literals(['obstruction', 'cloud', 'focus', 'tracking-or-guiding', 'dew-or-frost', 'bright-sky-or-moon', 'normal-variation', 'unknown'])

export type ReviewCause = typeof ReviewCause.Type

export const ReviewReason = Schema.Literals(['hfd', 'stars', 'elongation', 'guide-lost', 'worse-again'])

export type ReviewReason = typeof ReviewReason.Type

const Fraction = Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }))

export const ReviewAnswer = Schema.Struct({
  sees: Schema.String,
  cause: ReviewCause,
  confidence: Fraction,
  fix: Schema.String,
  line: Schema.String,
})

export type ReviewAnswer = typeof ReviewAnswer.Type

export const ReviewFailureKind = Schema.Literals(['no-credential', 'rejected', 'no-credit', 'rate-limited', 'unreachable', 'refused', 'truncated', 'unreadable-answer', 'no-picture', 'other'])

export type ReviewFailureKind = typeof ReviewFailureKind.Type

export const ReviewFailure = Schema.Struct({ kind: ReviewFailureKind, message: Schema.String })

export type ReviewFailure = typeof ReviewFailure.Type

export const ReviewOutcome = Schema.Union([Schema.TaggedStruct('Answered', { answer: ReviewAnswer }), Schema.TaggedStruct('Failed', { failure: ReviewFailure })])

export type ReviewOutcome = typeof ReviewOutcome.Type

export const ReviewStats = Schema.Struct({
  hfdPixels: Schema.NullOr(Schema.Number),
  stars: Schema.NullOr(Schema.Number),
  elongation: Schema.NullOr(Schema.Number),
})

export type ReviewStats = typeof ReviewStats.Type

export const ReviewUsage = Schema.Struct({ inputTokens: Schema.Int, outputTokens: Schema.Int })

export type ReviewUsage = typeof ReviewUsage.Type

export const reviewPath = '/review'
