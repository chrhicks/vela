import { describe, expect, it } from 'vitest'
import { latestReview, noReviews, reviews, tonightsReviews, type Reviews } from './review.ts'
import { clear, failed, fold, obstructed, reviewAnswered, reviewAsked } from './testing.ts'

const reduce = (entries: Parameters<typeof fold>[2]) => fold<Reviews>(reviews, noReviews, entries)

describe('reviews', () => {
  it('opens a review when a frame is asked about, with no replies yet', () => {
    const state = reduce([reviewAsked('rv1', 1000, 'M-31_light_0009.fits')])

    expect(state).toHaveLength(1)
    expect(state[0]).toMatchObject({ id: 'rv1', at: 1000, file: 'M-31_light_0009.fits', models: ['claude-opus-5-5', 'claude-haiku-5-5'], replies: [] })
  })

  it('adds each model\'s reply to its review, answered or failed', () => {
    const state = reduce([
      reviewAsked('rv1', 1000, 'M-31_light_0009.fits'),
      reviewAnswered('rv1', 1010, 'M-31_light_0009.fits', 'claude-opus-5-5', obstructed),
      reviewAnswered('rv1', 1012, 'M-31_light_0009.fits', 'claude-haiku-5-5', failed),
    ])

    expect(state[0]?.replies.map(reply => [reply.model, reply.outcome._tag])).toEqual([
      ['claude-opus-5-5', 'Answered'],
      ['claude-haiku-5-5', 'Failed'],
    ])
    expect(state[0]?.replies[0]).toMatchObject({ seconds: 12.5, usage: { inputTokens: 1800, outputTokens: 90 } })
  })

  it('replaces a model\'s earlier reply when the same answer arrives again', () => {
    const state = reduce([
      reviewAsked('rv1', 1000, 'M-31_light_0009.fits'),
      reviewAnswered('rv1', 1010, 'M-31_light_0009.fits', 'claude-opus-5-5', failed),
      reviewAnswered('rv1', 1011, 'M-31_light_0009.fits', 'claude-opus-5-5', clear),
    ])

    expect(state[0]?.replies).toHaveLength(1)
    expect(state[0]?.replies[0]?.outcome._tag).toBe('Answered')
  })

  it('ignores an answer to a review it does not hold and an ask it already holds', () => {
    const asked = reduce([reviewAsked('rv1', 1000, 'M-31_light_0009.fits')])
    const again = reduce([reviewAsked('rv1', 1000, 'M-31_light_0009.fits'), reviewAsked('rv1', 1001, 'M-31_light_0009.fits'), reviewAnswered('rv9', 1002, 'x.fits', 'claude-opus-5-5', clear)])

    expect(again).toEqual(asked)
  })

  it('names the latest review and lists a night\'s reviews newest first', () => {
    const state = reduce([reviewAsked('rv1', 1000, 'a.fits', {}, '2026-11-07'), reviewAsked('rv2', 2000, 'b.fits'), reviewAsked('rv3', 3000, 'c.fits')])

    expect(latestReview(state)?.id).toBe('rv3')
    expect(latestReview(noReviews)).toBeUndefined()
    expect(tonightsReviews(state, '2026-11-08' as never).map(review => review.id)).toEqual(['rv3', 'rv2'])
  })

  it('keeps only the night being asked about when a new night starts', () => {
    const state = reduce([reviewAsked('rv1', 1000, 'a.fits', {}, '2026-11-07'), reviewAsked('rv2', 2000, 'b.fits'), reviewAsked('rv3', 3000, 'c.fits')])

    expect(state.map(review => review.id)).toEqual(['rv2', 'rv3'])
  })

  it('rejects an answer whose confidence is outside 0 to 1', () => {
    const bad = { _tag: 'Answered', answer: { ...clear.answer, confidence: 1.4 } }

    expect(() => reduce([reviewAsked('rv1', 1000, 'a.fits'), reviewAnswered('rv1', 1010, 'a.fits', 'claude-opus-5-5', bad)])).toThrow()
  })
})
