import { Context, Effect, Option, Semaphore } from 'effect'
import type { Done } from '../../state/commands.ts'
import { CommandRefused } from '../feed/commands.ts'
import { Feed } from '../feed/feed.ts'
import { DeviceCommands } from './device-commands.ts'
import { MountRuns } from './mount.ts'
import { endOfMove, nextIdle } from './settle.ts'

export class FocusSettings extends Context.Service<FocusSettings, { readonly moveSeconds: number }>()('vela/FocusSettings') {}

export class Autofocusing extends Context.Service<Autofocusing, { readonly start: (exposureSeconds: number) => Effect.Effect<void, CommandRefused> }>()('vela/Autofocusing') {}

const notConnected = new CommandRefused({ refusal: { code: 'not-connected', device: 'focuser' } })

export const focusControls = Effect.gen(function* () {
  const feed = yield* Feed
  const commands = yield* DeviceCommands
  const runs = yield* MountRuns
  const autofocusing = yield* Autofocusing
  const { moveSeconds } = yield* FocusSettings
  const moves = yield* Semaphore.make(1)

  const focuser = Effect.flatMap(feed.current, rig => {
    const reported = rig.devices.focuser

    return reported.CONNECTION?.values.CONNECT === true ? Effect.succeed(reported) : Effect.fail(notConnected)
  })

  const move = (targetFrom: (current: number) => number) =>
    moves.withPermits(1)(
      Effect.scoped(
        Effect.gen(function* () {
          const waiting = yield* feed.subscribe

          if ((yield* focuser).ABS_FOCUS_POSITION?.state === 'Busy') yield* nextIdle(waiting.entries, 'focuser', 'ABS_FOCUS_POSITION', moveSeconds)

          const reported = (yield* focuser).ABS_FOCUS_POSITION
          const current = reported?.values.FOCUS_ABSOLUTE_POSITION

          if (current === undefined) return yield* Effect.fail(notConnected)

          const position = targetFrom(current)
          const limits = reported?.limits?.['FOCUS_ABSOLUTE_POSITION']

          if (limits !== undefined && (position < limits.min || position > limits.max)) return yield* Effect.fail(new CommandRefused({ refusal: { code: 'out-of-range', value: position, ...limits } }))

          if (position === current) return { code: 'focused', position } satisfies Done

          const moving = yield* feed.subscribe

          yield* commands.write('focuser', 'ABS_FOCUS_POSITION', { FOCUS_ABSOLUTE_POSITION: position })

          const ended = yield* endOfMove(moving.entries, 'focuser', 'ABS_FOCUS_POSITION', moveSeconds)

          if (Option.isNone(ended)) return { code: 'focusing', position } satisfies Done
          if (ended.value === 'Alert') return yield* Effect.fail(new CommandRefused({ refusal: { code: 'move-failed', device: 'focuser' } }))

          return { code: 'focused', position: (yield* focuser).ABS_FOCUS_POSITION?.values.FOCUS_ABSOLUTE_POSITION ?? position } satisfies Done
        }),
      ),
    )

  return {
    autofocus: (exposureSeconds: number) =>
      Effect.gen(function* () {
        yield* focuser

        const endedRun = yield* runs.endRun

        yield* runs.idle
        yield* autofocusing.start(exposureSeconds)

        return { code: 'autofocusing', exposureSeconds, endedRun } satisfies Done
      }),
    focusTo: (position: number) => move(() => position),
    focusBy: (steps: number) => move(current => current + steps),
  }
})
