import { Context, Duration, Effect, Option, Result, Stream } from 'effect'
import type { Done } from '../../state/commands.ts'
import { readRigEntry } from '../../state/entries.ts'
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

  const connected = call('get_connected').pipe(Effect.flatMap(isConnected => (isConnected === true ? Effect.void : call('set_connected', { connected: true }, connectSeconds))))

  const guide = (recalibrate: boolean) => connected.pipe(Effect.andThen(call('guide', { settle, recalibrate })), Effect.as<Done>({ code: 'guiding-starting', recalibrate }))

  return {
    startGuiding: guide(false),
    calibrateGuiding: guide(true),
    stopGuiding: call('stop_capture').pipe(Effect.as<Done>({ code: 'guiding-stopped' })),
    pickGuideStar: connected.pipe(Effect.andThen(call('loop')), Effect.andThen(call('find_star')), Effect.andThen(call('guide', { settle, recalibrate: false })), Effect.as<Done>({ code: 'guiding-starting', recalibrate: false })),
  }
})
