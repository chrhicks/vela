import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { foldRig } from '../../state/testing.ts'
import { entry } from '../../state/testing.ts'
import type { Entry } from '../../state/entry.ts'
import { decodeConfig } from '../config.ts'
import { makeReview, PictureUnavailable, type ReviewPorts } from './review.ts'
import { ReviewFailed, type Reply } from './reviewer.ts'
import type { ReviewRequest } from './request.ts'
import { ReviewSettings } from './settings.ts'

const settings = { ...decodeConfig(ReviewSettings, {}), baselineFrames: 3, cooldownFrames: 2 }

const answer: Reply = { answer: { sees: 'Stars cut off along the bottom edge.', cause: 'obstruction', confidence: 0.8, fix: 'Pick a target that clears the roofline.', line: 'Target behind an obstruction' }, usage: { inputTokens: 3000, outputTokens: 300 } }

const minute = 60_000
const t0 = 1_000_000

const started = (frameType = 'light') => entry('vela.run.started', t0, { run: 'r1', object: 'IC 1396', frameType, exposureSeconds: 180, count: 100, sequence: 'IC-1396_light_dual', filter: 'in', target: { id: 'ic1396', name: 'IC 1396', raDegrees: 324.5, decDegrees: 57.5 } })

const file = (n: number) => `IC-1396_light_dual_${String(n).padStart(4, '0')}.fits`

function frame(n: number, stats: { hfdPixels: number; stars: number; elongation?: number }): ReadonlyArray<Entry> {
  const at = t0 + n * 3 * minute

  return [entry('vela.frame', at, { night: '2026-11-18', file: file(n), sequence: 'IC-1396_light_dual' }), entry('vela.frame.stats', at + 20_000, { night: '2026-11-18', file: file(n), sequence: 'IC-1396_light_dual', stars: stats.stars, hfdPixels: stats.hfdPixels, elongation: stats.elongation ?? 1.1, sky: 1200, noise: 30 })]
}

const steady = (n: number) => frame(n, { hfdPixels: 2.4, stars: 2900 })

const poor = (n: number) => frame(n, { hfdPixels: 3.3, stars: 1900 })

const starLost = (at: number) => entry('phd2.StarLost', at, { Event: 'StarLost' })

function rig(options: { readonly settings?: typeof settings; readonly reviewer?: (model: string, request: ReviewRequest) => Effect.Effect<Reply, ReviewFailed>; readonly pictureFails?: boolean; readonly live?: () => boolean } = {}) {
  const published: Array<{ readonly kind: string; readonly id: string; readonly body: Readonly<Record<string, unknown>> }> = []
  const kept: string[] = []
  const reports: string[] = []
  const requests: Array<{ readonly model: string; readonly request: ReviewRequest }> = []
  let ids = 0
  let clock = 5_000_000

  const ports: ReviewPorts = {
    settings: options.settings ?? settings,
    filterNames: { in: 'Dual band', out: 'None' },
    reviewer: {
      ask: (model, request) => {
        requests.push({ model, request })

        return (options.reviewer ?? (() => Effect.succeed(answer)))(model, request)
      },
    },
    picture: (night, name) => (options.pictureFails === true ? Effect.fail(new PictureUnavailable({ night, file: name, cause: 'no such file' })) : Effect.succeed({ width: 8, height: 6, rgb: new Uint8Array(8 * 6 * 3).fill(90) })),
    aim: at => ({ altitudeDegrees: 50 - Math.round((at - t0) / minute / 10), azimuthDegrees: 60 }),
    publish: (kind, id, body) => void published.push({ kind, id, body }),
    keep: line => Effect.sync(() => void kept.push(line)),
    report: line => void reports.push(line),
    live: options.live ?? (() => true),
    now: () => (clock += 1500),
    newId: () => `rv${(ids += 1)}`,
  }

  return { review: makeReview(ports), published, kept, reports, requests }
}

async function play(subject: ReturnType<typeof rig>, entries: ReadonlyArray<Entry>) {
  for (const each of entries) subject.review.observe(each)
  await subject.review.whenIdle()
}

const baseline = [started(), ...[1, 2, 3].flatMap(steady)]

describe('reviewing a frame', () => {
  it('asks nothing while frames stay as they were', async () => {
    const subject = rig()

    await play(subject, [...baseline, ...[4, 5, 6].flatMap(steady)])

    expect(subject.published).toEqual([])
    expect(subject.requests).toEqual([])
  })

  it('asks every model the same request when the frame gets worse, and records the ask and each answer', async () => {
    const subject = rig()

    await play(subject, [...baseline, ...steady(4), ...poor(5)])

    expect(subject.requests.map(each => each.model)).toEqual(['claude-opus-5-5', 'claude-haiku-5-5'])
    expect(subject.requests[0]?.request).toBe(subject.requests[1]?.request)
    expect(subject.published.map(each => [each.kind, each.id])).toEqual([
      ['asked', 'rv1'],
      ['answer', 'rv1:claude-opus-5-5'],
      ['answer', 'rv1:claude-haiku-5-5'],
    ])
    expect(subject.published[0]?.body).toMatchObject({ review: 'rv1', run: 'r1', night: '2026-11-18', file: file(5), goodFile: file(4), reasons: ['hfd', 'stars'], models: ['claude-opus-5-5', 'claude-haiku-5-5'] })
    expect(subject.published[1]?.body).toMatchObject({ review: 'rv1', file: file(5), model: 'claude-opus-5-5', outcome: { _tag: 'Answered', answer: { cause: 'obstruction' } }, usage: { inputTokens: 3000, outputTokens: 300 } })
    expect(subject.kept.map(line => (JSON.parse(line) as { kind: string }).kind)).toEqual(['vela.review.asked', 'vela.review.answer', 'vela.review.answer'])
  })

  it('publishes entries the rig state reads back into one review with both replies', async () => {
    const subject = rig()

    await play(subject, [...baseline, ...poor(4)])

    const state = foldRig(subject.published.map((each, index) => entry(`vela.review.${each.kind}`, 9000 + index, each.body)))

    expect(state.reviews).toHaveLength(1)
    expect(state.reviews[0]?.replies.map(reply => reply.model)).toEqual(['claude-opus-5-5', 'claude-haiku-5-5'])
  })

  it('sends facts from relative time, the target by name, the filter by its name and the pointing, never the frame files', async () => {
    const subject = rig()

    await play(subject, [...baseline, ...steady(4), starLost(t0 + 14 * minute), starLost(t0 + 14.5 * minute), ...poor(5)])

    const { facts } = subject.requests[0]!.request

    expect(facts).toMatchObject({
      target: 'IC 1396',
      exposureSeconds: 180,
      filter: 'Dual band',
      reasons: ['hfd', 'stars'],
      baseline: { hfdPixels: 2.4, stars: 2900 },
      lastGood: { minutes: 12, hfdPixels: 2.4, stars: 2900, altitudeDegrees: 49, azimuthDegrees: 60 },
      current: { minutes: 15, hfdPixels: 3.3, stars: 1900 },
      events: [{ minutes: 14, event: 'StarLost' }, { minutes: 14.5, event: 'StarLost' }],
    })
    expect(facts.trend.map(row => row.minutes)).toEqual([3, 6, 9, 12, 15])
    expect(JSON.stringify(facts)).not.toContain('.fits')
  })

  it('counts star losses since the last frame towards a burst', async () => {
    const subject = rig()

    await play(subject, [...baseline, starLost(t0 + 10 * minute), starLost(t0 + 10.1 * minute), starLost(t0 + 10.2 * minute), ...steady(4)])

    expect(subject.published[0]?.body).toMatchObject({ reasons: ['guide-lost'] })
  })

  it('keeps one model failing from touching the other', async () => {
    const subject = rig({ reviewer: model => (model === 'claude-haiku-5-5' ? Effect.fail(new ReviewFailed({ kind: 'rate-limited', message: 'slow down' })) : Effect.succeed(answer)) })

    await play(subject, [...baseline, ...poor(4)])

    expect(subject.published.map(each => (each.body['outcome'] as { _tag: string } | undefined)?._tag)).toEqual([undefined, 'Answered', 'Failed'])
    expect(subject.published[2]?.body).toMatchObject({ model: 'claude-haiku-5-5', outcome: { _tag: 'Failed', failure: { kind: 'rate-limited', message: 'slow down' } } })
  })

  it('records a typed failure for each model when there is no sign-in, and tells the log once however many asks follow', async () => {
    const subject = rig({ reviewer: () => Effect.fail(new ReviewFailed({ kind: 'no-credential', message: 'Could not resolve authentication method' })) })

    await play(subject, [...baseline, ...poor(4), ...poor(5), ...poor(6), ...poor(7)])

    const answers = subject.published.filter(each => each.kind === 'answer')

    expect(answers.length).toBeGreaterThanOrEqual(4)
    expect(answers.every(each => (each.body['outcome'] as { failure: { kind: string } }).failure.kind === 'no-credential')).toBe(true)
    expect(subject.reports).toHaveLength(1)
    expect(subject.reports[0]).toContain('no-credential')
  })

  it('records a failure instead of an answer when a picture cannot be made, and still publishes both answers', async () => {
    const subject = rig({ pictureFails: true })

    await play(subject, [...baseline, ...poor(4)])

    expect(subject.requests).toEqual([])
    expect(subject.published.filter(each => each.kind === 'answer').map(each => (each.body['outcome'] as { failure: { kind: string } }).failure.kind)).toEqual(['no-picture', 'no-picture'])
  })

  it('does nothing when switched off, and nothing for a run that is not light frames of a target', async () => {
    const off = rig({ settings: { ...settings, enabled: false } })
    const flats = rig()

    await play(off, [...baseline, ...poor(4)])
    await play(flats, [started('flat'), ...[1, 2, 3].flatMap(steady), ...poor(4)])

    expect([off.published, flats.published]).toEqual([[], []])
  })

  it('reads the frames of a replayed run without asking, then asks about the next poor frame once the cooldown has passed', async () => {
    let live = false
    const subject = rig({ live: () => live })

    await play(subject, [...baseline, ...poor(4)])
    expect(subject.published).toEqual([])

    live = true
    await play(subject, poor(5))
    expect(subject.published).toEqual([])

    await play(subject, poor(6))
    expect(subject.published[0]?.body).toMatchObject({ file: file(6) })
  })

  it('starts the baseline over with each run', async () => {
    const subject = rig()

    await play(subject, [...baseline, started(), ...poor(1), ...poor(2), ...poor(3), ...poor(4)])

    expect(subject.published).toEqual([])
  })
})
