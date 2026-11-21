import { describe, expect, it } from 'vitest'
import { Schema } from 'effect'
import { ReviewAnswered } from './entries.ts'
import { behindTheTrees, latestReview, noReviews, reviews, tonightsReviews, type Reviews } from './review.ts'
import { clear, failed, fold, obstructed, reviewAnswered, reviewAsked, velaStarted } from './testing.ts'

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

  it('fails the replies still waiting when Vela starts again, and keeps those that came', () => {
    const state = reduce([reviewAsked('rv1', 1000, 'M-31_light_0009.fits'), reviewAnswered('rv1', 1010, 'M-31_light_0009.fits', 'claude-opus-5-5', obstructed), velaStarted(1030)])

    expect(state[0]?.replies).toHaveLength(2)
    expect(state[0]?.replies[0]).toMatchObject({ model: 'claude-opus-5-5', outcome: { _tag: 'Answered' } })
    expect(state[0]?.replies[1]).toMatchObject({ model: 'claude-haiku-5-5', seconds: 0.03, outcome: { _tag: 'Failed', failure: { kind: 'restarted' } } })
  })

  it('lets an answer that did arrive replace the failure', () => {
    const state = reduce([reviewAsked('rv1', 1000, 'M-31_light_0009.fits'), velaStarted(1030), reviewAnswered('rv1', 1040, 'M-31_light_0009.fits', 'claude-haiku-5-5', clear)])

    expect(state[0]?.replies.filter(reply => reply.model === 'claude-haiku-5-5')).toHaveLength(1)
    expect(state[0]?.replies.find(reply => reply.model === 'claude-haiku-5-5')?.outcome._tag).toBe('Answered')
  })
})

const withLine = (lowestDegrees: number) => ({ centreDegrees: 3, lowestDegrees, heightDegrees: 2.2, source: 'solve' })

describe('the frame against the mapped line', () => {
  const replyOf = (outcome: unknown, line?: unknown) => {
    const answered = reviewAnswered('rv1', 1010, 'a.fits', 'claude-opus-5-5', outcome)

    return reduce([reviewAsked('rv1', 1000, 'a.fits'), { ...answered, body: { ...(answered.body as object), ...(line === undefined ? {} : { line }) } }])[0]?.replies[0]
  }

  it('keeps the line a model\'s answer was recorded with', () => {
    expect(replyOf(obstructed, withLine(-0.4))?.line).toEqual(withLine(-0.4))
  })

  it('is behind the trees when a model says obstructed and some of the frame is below the line', () => {
    expect(behindTheTrees(replyOf(obstructed, withLine(-0.4))!)).toBe(true)
    expect(behindTheTrees(replyOf(obstructed, withLine(0.4))!)).toBe(false)
    expect(behindTheTrees(replyOf(clear, withLine(-5))!)).toBe(false)
    expect(behindTheTrees(replyOf(failed, withLine(-5))!)).toBe(false)
  })

  it('leaves an answer with no line, as the old ones were, an open question', () => {
    expect(replyOf(obstructed)?.line).toBeUndefined()
    expect(behindTheTrees(replyOf(obstructed)!)).toBe(false)
  })

  it('still reads an answer line recorded before the line existed', () => {
    const old = JSON.parse(
      '{"kind":"vela.review.answer","at":1763443000000,"review":"rv1","night":"2026-11-18","file":"M-31_light_0009.fits","model":"claude-opus-5-5","seconds":12.5,"outcome":{"_tag":"Answered","answer":{"obstructed":true,"confidence":0.8,"hazard":"trees","what":"Dark shapes."}},"usage":{"inputTokens":1800,"outputTokens":90}}',
    ) as { kind: string; at: number }
    const { kind, at, ...body } = old

    expect(Schema.is(ReviewAnswered.fields.body)(body)).toBe(true)
    expect(Schema.is(ReviewAnswered.fields.body)({ ...body, line: withLine(-1) })).toBe(true)
    expect(Schema.is(ReviewAnswered.fields.body)({ ...body, line: { centreDegrees: 3 } })).toBe(false)
    expect(kind).toBe('vela.review.answer')
    expect(at).toBe(1763443000000)
  })
})
