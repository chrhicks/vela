import { Data, Effect, Result, Schema } from 'effect'
import { FrameKept, FrameMeasured, GuiderReported, RunEnded, RunStarted } from '../../state/entries.ts'
import type { FilterAnswer } from '../../state/commands.ts'
import type { Entry } from '../../state/entry.ts'
import type { ReviewFailureKind, ReviewOutcome, ReviewStats, ReviewUsage } from '../../state/review-answer.ts'
import { runHandledPromise } from '../edge.ts'
import type { Aim } from './aim.ts'
import { pictureFor, type Rgb } from './image.ts'
import type { ReviewEvent, ReviewFacts, ReviewRequest, TrendRow } from './request.ts'
import { ReviewFailed, type Reply, type Reviewer } from './reviewer.ts'
import type { ReviewSettings } from './settings.ts'
import { newTrigger, observe as observeFrame, type Ask, type Sample, type Trigger } from './trigger.ts'

export class PictureUnavailable extends Data.TaggedError('PictureUnavailable')<{ readonly night: string; readonly file: string; readonly cause: unknown }> {}

export class NotKept extends Data.TaggedError('NotKept')<{ readonly path: string; readonly cause: unknown }> {}

export interface ReviewPorts {
  readonly settings: ReviewSettings
  readonly filterNames: Readonly<Record<FilterAnswer, string>>
  readonly reviewer: Reviewer['Service']
  readonly picture: (night: string, file: string) => Effect.Effect<Rgb, PictureUnavailable>
  readonly aim: (at: number) => Aim | undefined
  readonly publish: (kind: 'asked' | 'answer', id: string, body: Readonly<Record<string, unknown>>) => void
  readonly keep: (line: string) => Effect.Effect<void, NotKept>
  readonly report: (line: string) => void
  readonly live: () => boolean
  readonly now: () => number
  readonly newId: () => string
}

const Observed = Schema.Union([RunStarted, RunEnded, FrameKept, FrameMeasured, GuiderReported])

const isObservedKind = Schema.is(Schema.Union(Observed.members.map(member => member.fields.kind)))

const decodeObserved = Schema.decodeUnknownResult(Observed)

const loud: ReadonlySet<ReviewFailureKind> = new Set(['no-credential', 'rejected', 'no-credit'])

interface Running {
  readonly id: string
  readonly target: string
  readonly exposureSeconds: number
  readonly filter: string | undefined
  readonly sequence: string | undefined
  readonly startedAt: number
}

interface Row {
  readonly night: string
  readonly file: string
  readonly row: TrendRow
}

const minutesOf = (from: number, at: number) => Math.round(((at - from) / 60000) * 10) / 10

const statsOf = ({ hfdPixels, stars, elongation }: Sample): ReviewStats => ({ hfdPixels, stars, elongation })

export function makeReview(ports: ReviewPorts) {
  const { settings } = ports
  const limits = settings
  let running: Running | undefined
  let trigger: Trigger = newTrigger
  let rows: ReadonlyArray<Row> = []
  let events: ReadonlyArray<{ readonly at: number; readonly event: ReviewEvent['event'] }> = []
  let lostSinceFrame = 0
  const keptAt = new Map<string, number>()
  const told = new Set<ReviewFailureKind>()
  let keepReported = false
  let queue: Promise<void> = Promise.resolve()

  const outcomeOf = (result: Result.Result<Reply, ReviewFailed>): { readonly outcome: ReviewOutcome; readonly usage: ReviewUsage | undefined } =>
    Result.match(result, {
      onSuccess: reply => {
        told.clear()

        return { outcome: { _tag: 'Answered', answer: reply.answer }, usage: reply.usage }
      },
      onFailure: failure => ({ outcome: { _tag: 'Failed', failure: { kind: failure.kind, message: failure.message } }, usage: undefined }),
    })

  const record = (kind: 'asked' | 'answer', id: string, body: Readonly<Record<string, unknown>>) =>
    Effect.sync(() => ports.publish(kind, id, body)).pipe(
      Effect.andThen(ports.keep(JSON.stringify({ kind: `vela.review.${kind}`, at: ports.now(), ...body }))),
      Effect.catchTag('NotKept', failure =>
        Effect.sync(() => {
          if (keepReported) return

          keepReported = true
          ports.report(`frame review: could not append to ${failure.path}: ${String(failure.cause)}`)
        }),
      ),
    )

  const askModel = (review: string, night: string, file: string, model: string, request: Effect.Effect<ReviewRequest, PictureUnavailable>) =>
    Effect.gen(function* () {
      const started = ports.now()
      const result = yield* request.pipe(
        Effect.mapError(failure => new ReviewFailed({ kind: 'no-picture', message: `the picture of ${failure.file} could not be made: ${String(failure.cause)}` })),
        Effect.flatMap(built => ports.reviewer.ask(model, built)),
        Effect.result,
      )
      const { outcome, usage } = outcomeOf(result)

      if (outcome._tag === 'Failed' && loud.has(outcome.failure.kind) && !told.has(outcome.failure.kind)) {
        told.add(outcome.failure.kind)
        ports.report(`frame review: ${model}: ${outcome.failure.kind}: ${outcome.failure.message}`)
      }

      yield* record('answer', `${review}:${model}`, { review, night, file, model, seconds: Math.round(((ports.now() - started) / 1000) * 10) / 10, outcome, ...(usage === undefined ? {} : { usage }) })
    })

  const ask = (current: Row, run: Running, asked: Ask, taken: ReadonlyArray<Row>, happened: typeof events) =>
    Effect.gen(function* () {
      const review = ports.newId()
      const good = taken.find(each => each.file === asked.good.file)

      yield* record('asked', review, {
        review,
        run: run.id,
        night: current.night,
        file: current.file,
        goodFile: asked.good.file,
        reasons: asked.reasons,
        baseline: { hfdPixels: asked.baseline.hfdPixels, stars: asked.baseline.stars, elongation: null },
        current: statsOf({ file: current.file, hfdPixels: current.row.hfdPixels, stars: current.row.stars, elongation: current.row.elongation, guideLost: 0 }),
        models: settings.models,
      })

      const window = taken.slice(-settings.trendFrames)
      const since = window[0]?.row.minutes ?? 0
      const facts: ReviewFacts = {
        target: run.target,
        exposureSeconds: run.exposureSeconds,
        ...(run.filter === undefined ? {} : { filter: run.filter }),
        reasons: asked.reasons,
        baseline: { hfdPixels: asked.baseline.hfdPixels, stars: asked.baseline.stars },
        lastGood: good?.row ?? current.row,
        current: current.row,
        trend: window.map(each => each.row),
        events: happened
          .map(each => ({ minutes: minutesOf(run.startedAt, each.at), event: each.event }))
          .filter(each => each.minutes >= since)
          .slice(-settings.eventsSent),
      }
      const picture = (night: string, file: string) => ports.picture(night, file).pipe(Effect.map(rgb => pictureFor(rgb, settings.imageLongSide, settings.imageMaxBytes)))
      const request = Effect.all({ good: picture(good?.night ?? current.night, asked.good.file), current: picture(current.night, current.file) }).pipe(Effect.map(({ good: goodPicture, current: currentPicture }) => ({ good: goodPicture, current: currentPicture, facts })))
      const built = yield* Effect.cached(request)

      yield* Effect.forEach(settings.models, model => askModel(review, current.night, current.file, model, built), { concurrency: 'unbounded', discard: true })
    })

  const frameMeasured = (entry: { readonly at: number; readonly body: typeof FrameMeasured.Type['body'] }, run: Running) => {
    const { night, file, stars, hfdPixels, elongation, sky, noise, sequence } = entry.body

    if (sequence !== undefined && run.sequence !== undefined && sequence !== run.sequence) return

    const at = keptAt.get(file) ?? entry.at
    const aim = ports.aim(at)
    const row: Row = { night, file, row: { minutes: minutesOf(run.startedAt, at), hfdPixels, stars, elongation, sky, noise, altitudeDegrees: aim?.altitudeDegrees ?? null, azimuthDegrees: aim?.azimuthDegrees ?? null } }
    const sample: Sample = { file, hfdPixels, stars, elongation, guideLost: lostSinceFrame }
    const next = observeFrame(limits, trigger, sample)

    lostSinceFrame = 0
    trigger = next.state
    rows = [...rows, row]

    if (next.ask === undefined || !ports.live()) return

    const asked = next.ask
    const taken = rows
    const happened = events

    queue = queue.then(() => runHandledPromise(ask(row, run, asked, taken, happened)))
  }

  function observe(entry: Entry) {
    if (!settings.enabled || !isObservedKind(entry.kind)) return

    const decoded = decodeObserved(entry)

    if (Result.isFailure(decoded)) return

    const seen = decoded.success

    switch (seen.kind) {
      case 'vela.run.started': {
        const { run: id, object, frameType, exposureSeconds, target, sequence, filter } = seen.body

        running = object._tag === 'Target' && frameType === 'light' ? { id, target: target?.name ?? object.name, exposureSeconds, filter: filter === undefined ? undefined : ports.filterNames[filter], sequence, startedAt: seen.at } : undefined
        trigger = newTrigger
        rows = []
        events = []
        lostSinceFrame = 0

        return
      }
      case 'vela.frame':
        keptAt.set(seen.body.file, seen.at)

        return
      case 'vela.frame.stats':
        if (running !== undefined) frameMeasured(seen, running)

        return
      case 'vela.run.ended':
        return
      default:
        if (running === undefined) return
        if (seen.body.Event === 'StarLost') {
          lostSinceFrame += 1
          events = [...events, { at: seen.at, event: 'StarLost' }]
        } else if (seen.body.Event === 'SettleDone' && seen.body.Error !== undefined) events = [...events, { at: seen.at, event: 'SettleFailed' }]
    }
  }

  return { observe, whenIdle: () => queue }
}
