import { Data, Effect, Result, Schema } from 'effect'
import { FrameKept, RunEnded, RunStarted } from '../../state/entries.ts'
import type { Entry } from '../../state/entry.ts'
import type { ReviewFailureKind, ReviewLine, ReviewOutcome, ReviewUsage } from '../../state/review-answer.ts'
import { runHandledPromise } from '../edge.ts'
import type { Horizon } from '../horizon/horizon.ts'
import { pictureFor, type Rgb } from './image.ts'
import { lineOf, type FrameView } from './line.ts'
import type { ReviewRequest } from './request.ts'
import { ReviewFailed, type Reply, type Reviewer } from './reviewer.ts'
import type { ReviewSettings } from './settings.ts'

export class PictureUnavailable extends Data.TaggedError('PictureUnavailable')<{ readonly night: string; readonly file: string; readonly cause: unknown }> {}

export class NotKept extends Data.TaggedError('NotKept')<{ readonly path: string; readonly cause: unknown }> {}

export interface Shot extends Rgb {
  readonly exposureSeconds: number | undefined
}

export interface ReviewPorts {
  readonly settings: ReviewSettings
  readonly reviewer: Reviewer['Service']
  readonly picture: (night: string, file: string) => Effect.Effect<Shot, PictureUnavailable>
  readonly placed: (night: string, file: string) => Effect.Effect<FrameView | undefined>
  readonly horizon: Horizon
  readonly publish: (kind: 'asked' | 'answer', id: string, body: Readonly<Record<string, unknown>>) => void
  readonly keep: (line: string) => Effect.Effect<void, NotKept>
  readonly report: (line: string) => void
  readonly live: () => boolean
  readonly now: () => number
  readonly newId: () => string
}

const Observed = Schema.Union([RunStarted, RunEnded, FrameKept])

const isObservedKind = Schema.is(Schema.Union(Observed.members.map(member => member.fields.kind)))

const decodeObserved = Schema.decodeUnknownResult(Observed)

const loud: ReadonlySet<ReviewFailureKind> = new Set(['no-credential', 'rejected', 'no-credit'])

interface Running {
  readonly id: string
  readonly exposureSeconds: number
  readonly sequence: string | undefined
}

const tenths = (value: number) => Math.round(value * 10) / 10

export function makeReview(ports: ReviewPorts) {
  const { settings } = ports
  let running: Running | undefined
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

  const askModel = (review: string, night: string, file: string, model: string, line: ReviewLine | undefined, request: Effect.Effect<ReviewRequest, PictureUnavailable>) =>
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

      yield* record('answer', `${review}:${model}`, { review, night, file, model, seconds: tenths((ports.now() - started) / 1000), outcome, ...(usage === undefined ? {} : { usage }), ...(line === undefined ? {} : { line }) })
    })

  const ask = (night: string, file: string, run: Running) =>
    Effect.gen(function* () {
      const review = ports.newId()

      yield* record('asked', review, { review, run: run.id, night, file, models: settings.models })

      const line = yield* ports.placed(night, file).pipe(Effect.map(view => (view === undefined ? undefined : lineOf(view, ports.horizon))))
      const request = ports.picture(night, file).pipe(
        Effect.map(shot => ({
          picture: pictureFor(shot, settings.imageLongSide, settings.imageMaxBytes),
          exposureSeconds: tenths(shot.exposureSeconds ?? run.exposureSeconds),
          ...(line === undefined ? {} : { line }),
        })),
      )
      const built = yield* Effect.cached(request)

      yield* Effect.forEach(settings.models, model => askModel(review, night, file, model, line, built), { concurrency: 'unbounded', discard: true })
    })

  function observe(entry: Entry) {
    if (!settings.enabled || !isObservedKind(entry.kind)) return

    const decoded = decodeObserved(entry)

    if (Result.isFailure(decoded)) return

    const seen = decoded.success

    switch (seen.kind) {
      case 'vela.run.started': {
        const { run: id, object, frameType, exposureSeconds, sequence } = seen.body

        running = object._tag === 'Target' && frameType === 'light' ? { id, exposureSeconds, sequence } : undefined

        return
      }
      case 'vela.frame': {
        const { night, file, sequence } = seen.body

        if (running === undefined || !ports.live()) return
        if (sequence !== undefined && running.sequence !== undefined && sequence !== running.sequence) return

        const run = running

        queue = queue.then(() => runHandledPromise(ask(night, file, run)))

        return
      }
      case 'vela.run.ended':
        return
    }
  }

  return { observe, whenIdle: () => queue }
}
