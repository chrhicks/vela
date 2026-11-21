import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { behindTheTrees } from '../../state/review.ts'
import { foldRig } from '../../state/testing.ts'
import { entry } from '../../state/testing.ts'
import type { Entry } from '../../state/entry.ts'
import { decodeConfig } from '../config.ts'
import { makeReview, PictureUnavailable, type ReviewPorts, type Shot } from './review.ts'
import { ReviewFailed, type Reply } from './reviewer.ts'
import { questionOf, type ReviewRequest } from './request.ts'
import { noHorizon, type Horizon } from '../horizon/horizon.ts'
import { fromMount } from '../sky/coordinates.ts'
import { equatorialOfDate } from '../sky/horizontal.ts'
import type { FrameView } from './line.ts'
import { ReviewSettings } from './settings.ts'

const settings = decodeConfig(ReviewSettings, {})

const answer: Reply = { answer: { obstructed: true, confidence: 0.8, hazard: 'high-tension power poles/lines', what: 'Two soft bright bands cross the frame.' }, usage: { inputTokens: 1800, outputTokens: 90 } }

const t0 = 1_000_000

const started = (frameType = 'light', object = 'IC 1396') =>
  entry('vela.run.started', t0, { run: 'r1', object, frameType, exposureSeconds: 120, count: 100, sequence: 'IC-1396_light_dual', filter: 'in', target: { id: 'ic1396', name: 'IC 1396', raDegrees: 324.5, decDegrees: 57.5 } })

const file = (n: number) => `IC-1396_light_dual_${String(n).padStart(4, '0')}.fits`

const kept = (n: number, sequence = 'IC-1396_light_dual'): Entry => entry('vela.frame', t0 + n * 120_000, { night: '2026-11-18', file: file(n), sequence })

const shot = (exposureSeconds: number | undefined): Shot => ({ width: 8, height: 6, rgb: new Uint8Array(8 * 6 * 3).fill(90), exposureSeconds })

const phoenix = { latitudeDegrees: 33.45, longitudeDegrees: -112.07, elevationMeters: 331 }

const flat20: Horizon = { ...noHorizon, altitudesDegrees: Array.from({ length: 360 }, () => 20) }

const viewAt = (altitude: number, azimuth = 100): FrameView => {
  const ofDate = equatorialOfDate(altitude, azimuth, t0, phoenix)

  return { at: t0, site: phoenix, columns: 6248, rows: 4176, heightDegrees: 2.25, mount: fromMount({ raDegrees: ofDate.raHours * 15, decDegrees: ofDate.decDegrees }, new Date(t0)), solution: null }
}

function rig(options: { readonly placed?: FrameView | undefined; readonly horizon?: Horizon; readonly settings?: typeof settings; readonly reviewer?: (model: string, request: ReviewRequest) => Effect.Effect<Reply, ReviewFailed>; readonly pictureFails?: boolean; readonly exposure?: number | undefined; readonly live?: () => boolean } = {}) {
  const published: Array<{ readonly kind: string; readonly id: string; readonly body: Readonly<Record<string, unknown>> }> = []
  const lines: string[] = []
  const reports: string[] = []
  const requests: Array<{ readonly model: string; readonly request: ReviewRequest }> = []
  let ids = 0
  let clock = 5_000_000

  const ports: ReviewPorts = {
    settings: options.settings ?? settings,
    reviewer: {
      ask: (model, request) => {
        requests.push({ model, request })

        return (options.reviewer ?? (() => Effect.succeed(answer)))(model, request)
      },
    },
    placed: () => Effect.succeed(options.placed),
    horizon: options.horizon ?? flat20,
    picture: (night, name) => (options.pictureFails === true ? Effect.fail(new PictureUnavailable({ night, file: name, cause: 'no such file' })) : Effect.succeed(shot('exposure' in options ? options.exposure : 120))),
    publish: (kind, id, body) => void published.push({ kind, id, body }),
    keep: line => Effect.sync(() => void lines.push(line)),
    report: line => void reports.push(line),
    live: options.live ?? (() => true),
    now: () => (clock += 1500),
    newId: () => `rv${(ids += 1)}`,
  }

  return { review: makeReview(ports), published, lines, reports, requests }
}

async function play(subject: ReturnType<typeof rig>, entries: ReadonlyArray<Entry>) {
  for (const each of entries) subject.review.observe(each)
  await subject.review.whenIdle()
}

const textOf = (request: ReviewRequest | undefined) => (request === undefined ? '' : questionOf(request.exposureSeconds, settings.hazards, request.line))

describe('reviewing a frame against the mapped line', () => {
  it('sends the same sentence to every model and records the frame\'s line with each answer', async () => {
    const subject = rig({ placed: viewAt(23) })

    await play(subject, [started(), kept(1)])

    for (const each of subject.requests) expect(each.request.line).toEqual({ centreDegrees: 3, lowestDegrees: 1, heightDegrees: 2.3, source: 'mount' })
    expect(textOf(subject.requests[0]?.request)).toContain('The frame\'s centre is 3 degrees above the mapped tree line in its direction')
    expect(subject.published.filter(each => each.kind === 'answer').map(each => each.body['line'])).toHaveLength(2)
    expect(subject.published[0]?.body).toEqual({ review: 'rv1', run: 'r1', night: '2026-11-18', file: file(1), models: ['claude-opus-5-5', 'claude-haiku-5-5'] })
    expect(JSON.parse(subject.lines[1] ?? '{}')).toMatchObject({ kind: 'vela.review.answer', line: { centreDegrees: 3, source: 'mount' } })
  })

  it('adds no sentence and records no line when the frame is not placed, or the horizon has no value there', async () => {
    const unplaced = rig({ placed: undefined })
    const unmapped = rig({ placed: viewAt(23), horizon: noHorizon })

    await play(unplaced, [started(), kept(1)])
    await play(unmapped, [started(), kept(1)])

    for (const subject of [unplaced, unmapped]) {
      expect(Object.keys(subject.requests[0]?.request ?? {}).sort()).toEqual(['exposureSeconds', 'picture'])
      expect(subject.published.every(each => !('line' in each.body))).toBe(true)
    }
  })

  it('labels an obstructed answer behind the trees only when some of the frame is below the line', async () => {
    const entriesFor = async (altitude: number, horizon = flat20) => {
      const subject = rig({ placed: viewAt(altitude), horizon })

      await play(subject, [started(), kept(1)])

      return foldRig(subject.published.map((each, index) => entry(`vela.review.${each.kind}`, 9000 + index, each.body))).reviews[0]?.replies.map(behindTheTrees)
    }

    expect(await entriesFor(21)).toEqual([true, true])
    expect(await entriesFor(30)).toEqual([false, false])
    expect(await entriesFor(21, noHorizon)).toEqual([false, false])
  })
})

describe('reviewing a frame', () => {
  it('asks every model about each light frame once it is kept, with the same request, and records the ask and each answer', async () => {
    const subject = rig()

    await play(subject, [started(), kept(1)])

    expect(subject.requests.map(each => each.model)).toEqual(['claude-opus-5-5', 'claude-haiku-5-5'])
    expect(subject.requests[0]?.request).toBe(subject.requests[1]?.request)
    expect(subject.published.map(each => [each.kind, each.id])).toEqual([
      ['asked', 'rv1'],
      ['answer', 'rv1:claude-opus-5-5'],
      ['answer', 'rv1:claude-haiku-5-5'],
    ])
    expect(subject.published[0]?.body).toEqual({ review: 'rv1', run: 'r1', night: '2026-11-18', file: file(1), models: ['claude-opus-5-5', 'claude-haiku-5-5'] })
    expect(subject.published[1]?.body).toMatchObject({ review: 'rv1', file: file(1), model: 'claude-opus-5-5', outcome: { _tag: 'Answered', answer: { obstructed: true, hazard: 'high-tension power poles/lines' } }, usage: { inputTokens: 1800, outputTokens: 90 } })
    expect(subject.lines.map(line => (JSON.parse(line) as { kind: string }).kind)).toEqual(['vela.review.asked', 'vela.review.answer', 'vela.review.answer'])
  })

  it('asks about every frame, each with its own review', async () => {
    const subject = rig()

    await play(subject, [started(), kept(1), kept(2), kept(3)])

    expect(subject.published.filter(each => each.kind === 'asked').map(each => each.body['file'])).toEqual([file(1), file(2), file(3)])
    expect(subject.requests).toHaveLength(6)
  })

  it('sends one picture and the exposure the frame\'s own header gives, or the run\'s when the header has none', async () => {
    const own = rig({ exposure: 90 })
    const fallback = rig({ exposure: undefined })

    await play(own, [started(), kept(1)])
    await play(fallback, [started(), kept(1)])

    expect(own.requests[0]?.request.exposureSeconds).toBe(90)
    expect(fallback.requests[0]?.request.exposureSeconds).toBe(120)
    expect(Object.keys(own.requests[0]?.request ?? {}).sort()).toEqual(['exposureSeconds', 'picture'])
  })

  it('publishes entries the rig state reads back into one review per frame with both replies', async () => {
    const subject = rig()

    await play(subject, [started(), kept(1), kept(2)])

    const state = foldRig(subject.published.map((each, index) => entry(`vela.review.${each.kind}`, 9000 + index, each.body)))

    expect(state.reviews).toHaveLength(2)
    expect(state.reviews[0]?.replies.map(reply => reply.model)).toEqual(['claude-opus-5-5', 'claude-haiku-5-5'])
  })

  it('keeps one model failing from touching the other', async () => {
    const subject = rig({ reviewer: model => (model === 'claude-haiku-5-5' ? Effect.fail(new ReviewFailed({ kind: 'rate-limited', message: 'slow down' })) : Effect.succeed(answer)) })

    await play(subject, [started(), kept(1)])

    expect(subject.published.map(each => (each.body['outcome'] as { _tag: string } | undefined)?._tag)).toEqual([undefined, 'Answered', 'Failed'])
    expect(subject.published[2]?.body).toMatchObject({ model: 'claude-haiku-5-5', outcome: { _tag: 'Failed', failure: { kind: 'rate-limited', message: 'slow down' } } })
  })

  it('records a typed failure for each model when there is no sign-in, and tells the log once however many frames follow', async () => {
    const subject = rig({ reviewer: () => Effect.fail(new ReviewFailed({ kind: 'no-credential', message: 'Could not resolve authentication method' })) })

    await play(subject, [started(), kept(1), kept(2), kept(3), kept(4)])

    const answers = subject.published.filter(each => each.kind === 'answer')

    expect(answers).toHaveLength(8)
    expect(answers.every(each => (each.body['outcome'] as { failure: { kind: string } }).failure.kind === 'no-credential')).toBe(true)
    expect(subject.reports).toHaveLength(1)
    expect(subject.reports[0]).toContain('no-credential')
  })

  it('records a failure instead of an answer when the picture cannot be made, for both models', async () => {
    const subject = rig({ pictureFails: true })

    await play(subject, [started(), kept(1)])

    expect(subject.requests).toEqual([])
    expect(subject.published.filter(each => each.kind === 'answer').map(each => (each.body['outcome'] as { failure: { kind: string } }).failure.kind)).toEqual(['no-picture', 'no-picture'])
  })

  it('does nothing when switched off, for a run that is not light frames of a target (flats, or an operation such as autofocus), or before any run', async () => {
    const off = rig({ settings: { ...settings, enabled: false } })
    const flats = rig()
    const operation = rig()
    const none = rig()

    await play(off, [started(), kept(1)])
    await play(flats, [started('flat'), kept(1)])
    await play(operation, [started('light', 'autofocus'), kept(1)])
    await play(none, [kept(1)])

    expect([off.published, flats.published, operation.published, none.published]).toEqual([[], [], [], []])
  })

  it('leaves out a frame from another sequence than the run\'s', async () => {
    const subject = rig()

    await play(subject, [started(), kept(1, 'another_light')])

    expect(subject.published).toEqual([])
  })

  it('reads the frames of a replayed history without asking, then asks about the next frame once live', async () => {
    let live = false
    const subject = rig({ live: () => live })

    await play(subject, [started(), kept(1), kept(2)])
    expect(subject.published).toEqual([])

    live = true
    await play(subject, [kept(3)])
    expect(subject.published[0]?.body).toMatchObject({ file: file(3) })
  })

  it('stops asking once the run is replaced by one that is not light frames of a target', async () => {
    const subject = rig()

    await play(subject, [started(), kept(1), started('dark'), kept(2)])

    expect(subject.published.filter(each => each.kind === 'asked')).toHaveLength(1)
  })
})
