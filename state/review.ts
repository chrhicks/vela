import { Schema } from 'effect'
import { FrameFile, NightName, RunId, type RigEntry } from './entries.ts'
import { ReviewId, ReviewOutcome, ReviewReason, ReviewStats, ReviewUsage } from './review-answer.ts'

export const ReviewReply = Schema.Struct({
  model: Schema.NonEmptyString,
  seconds: Schema.Number,
  outcome: ReviewOutcome,
  usage: Schema.optional(ReviewUsage),
})

export type ReviewReply = typeof ReviewReply.Type

export const Review = Schema.Struct({
  id: ReviewId,
  at: Schema.Number,
  run: RunId,
  night: NightName,
  file: FrameFile,
  goodFile: FrameFile,
  reasons: Schema.Array(ReviewReason),
  baseline: ReviewStats,
  current: ReviewStats,
  models: Schema.Array(Schema.NonEmptyString),
  replies: Schema.Array(ReviewReply),
})

export type Review = typeof Review.Type

export const Reviews = Schema.Array(Review)

export type Reviews = typeof Reviews.Type

export const noReviews: Reviews = []

export function reviews(state: Reviews, entry: RigEntry): Reviews {
  switch (entry.kind) {
    case 'vela.review.asked': {
      const { review, run, night, file, goodFile, reasons, baseline, current, models } = entry.body

      if (state.some(known => known.id === review)) return state

      return [...state, { id: review, at: entry.at, run, night, file, goodFile, reasons, baseline, current, models, replies: [] }]
    }
    case 'vela.review.answer': {
      const { review, model, seconds, outcome, usage } = entry.body

      return state.map(known => (known.id === review ? { ...known, replies: [...known.replies.filter(reply => reply.model !== model), { model, seconds, outcome, usage }] } : known))
    }
    default:
      return state
  }
}

export const latestReview = (state: Reviews): Review | undefined => state.at(-1)

export const tonightsReviews = (state: Reviews, night: NightName): Reviews => state.filter(review => review.night === night).reverse()
