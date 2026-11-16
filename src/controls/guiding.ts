import { Context, Duration, Effect, Option, Result, Schema, Stream } from 'effect'
import type { Done } from '../../state/commands.ts'
import { isGuiderReport, readRigEntry } from '../../state/entries.ts'
import type { GuiderActivity } from '../../state/guiding.ts'
import type { Entry } from '../../state/entry.ts'
import { CommandRefused } from '../feed/commands.ts'
import { Feed } from '../feed/feed.ts'
import { DeviceCommands } from './device-commands.ts'

export class GuidingSettings extends Context.Service<
  GuidingSettings,
  { readonly settle: { readonly pixels: number; readonly time: number; readonly timeout: number }; readonly replySeconds: number; readonly connectSeconds: number; readonly newId: Effect.Effect<string> }
>()('vela/GuidingSettings') {}

interface Reply {
  readonly result: unknown
  readonly error: string | undefined
}

const replyTo =
  (id: string) =>
  (entry: Entry): Result.Result<Reply, Entry> =>
    Result.match(readRigEntry(entry), {
      onFailure: () => Result.fail(entry),
      onSuccess: found => {
        const replied = Option.getOrUndefined(found)

        return replied?.kind === 'phd2.reply' && replied.body.id === id ? Result.succeed({ result: replied.body.result, error: replied.body.error?.message }) : Result.fail(entry)
      },
    })

const guidingActivities: ReadonlyArray<GuiderActivity> = ['guiding', 'settling', 'calibrating', 'starLost', 'paused']

const capturingActivities: ReadonlyArray<GuiderActivity> = [...guidingActivities, 'looping', 'starPicked']

const captureStopped = (entry: Entry): Result.Result<true, Entry> =>
  Result.match(readRigEntry(entry), {
    onFailure: () => Result.fail(entry),
    onSuccess: found => {
      const reported = Option.getOrUndefined(found)

      return reported !== undefined && isGuiderReport(reported) && reported.body.Event === 'LoopingExposuresStopped' ? Result.succeed(true) : Result.fail(entry)
    },
  })

export const guidingControls = Effect.gen(function* () {
  const feed = yield* Feed
  const commands = yield* DeviceCommands
  const { settle, replySeconds, connectSeconds, newId } = yield* GuidingSettings

  const call = (method: string, params?: unknown, seconds = replySeconds): Effect.Effect<unknown, CommandRefused> =>
    Effect.scoped(
      Effect.gen(function* () {
        const { entries } = yield* feed.subscribe
        const id = yield* newId

        yield* commands.askGuider(id, method, params)

        const reply = yield* entries.pipe(Stream.filterMap(replyTo(id)), Stream.runHead, Effect.timeoutOption(Duration.seconds(seconds)), Effect.map(Option.flatten))

        if (Option.isNone(reply)) return yield* Effect.fail(new CommandRefused({ refusal: { code: 'guider-silent', seconds } }))
        if (reply.value.error !== undefined) return yield* Effect.fail(new CommandRefused({ refusal: { code: 'guider-refused', text: reply.value.error } }))

        return reply.value.result
      }),
    )

  const equipmentConnected = call('get_connected').pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Boolean)),
    Effect.catchTag('SchemaError', () => Effect.fail(new CommandRefused({ refusal: { code: 'guider-refused', text: 'its answer to get_connected was not yes or no' } }))),
  )

  const connected = equipmentConnected.pipe(Effect.flatMap(isConnected => (isConnected ? Effect.void : call('set_connected', { connected: true }, connectSeconds))))

  const guide = (recalibrate: boolean) => connected.pipe(Effect.andThen(call('guide', { settle, recalibrate })), Effect.as<Done>({ code: 'guiding-starting', recalibrate }))

  return {
    startGuiding: guide(false),
    calibrateGuiding: guide(true),
    stopGuiding: call('stop_capture').pipe(Effect.as<Done>({ code: 'guiding-stopped' })),
    pickGuideStar: Effect.scoped(
      Effect.gen(function* () {
        yield* connected

        const { link, activity } = (yield* feed.current).guiding

        if (link === 'connected' && activity !== undefined && capturingActivities.includes(activity)) {
          const { entries } = yield* feed.subscribe

          yield* call('stop_capture')

          const stopped = yield* entries.pipe(Stream.filterMap(captureStopped), Stream.runHead, Effect.timeoutOption(Duration.seconds(replySeconds)), Effect.map(Option.flatten))

          if (Option.isNone(stopped)) return yield* Effect.fail(new CommandRefused({ refusal: { code: 'guider-silent', seconds: replySeconds } }))
        }

        yield* call('guide', { settle, recalibrate: false })

        return { code: 'guiding-starting', recalibrate: false } satisfies Done
      }),
    ),
  }
})

export const mountGuiding = Effect.gen(function* () {
  const feed = yield* Feed
  const guiding = yield* guidingControls

  return {
    stop: Effect.gen(function* () {
      const { link, activity } = (yield* feed.current).guiding

      if (link !== 'connected' || activity === undefined || !capturingActivities.includes(activity)) return false

      yield* guiding.stopGuiding

      return guidingActivities.includes(activity)
    }),
    start: Effect.map(Effect.result(guiding.startGuiding), Result.isSuccess),
  }
})
