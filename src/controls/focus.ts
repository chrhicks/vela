import { Effect } from 'effect'
import type { Done } from '../../state/commands.ts'
import { CommandRefused } from '../feed/commands.ts'
import { Feed } from '../feed/feed.ts'
import { DeviceCommands } from './device-commands.ts'

const notConnected = new CommandRefused({ refusal: { code: 'not-connected', device: 'focuser' } })

export const focusControls = Effect.gen(function* () {
  const feed = yield* Feed
  const commands = yield* DeviceCommands

  const focuser = Effect.flatMap(feed.current, rig => {
    const reported = rig.devices.focuser

    return reported.CONNECTION?.values.CONNECT === true ? Effect.succeed(reported) : Effect.fail(notConnected)
  })

  const moveTo = (position: number) =>
    Effect.gen(function* () {
      const limits = (yield* focuser).ABS_FOCUS_POSITION?.limits?.['FOCUS_ABSOLUTE_POSITION']

      if (limits !== undefined && (position < limits.min || position > limits.max)) return yield* Effect.fail(new CommandRefused({ refusal: { code: 'out-of-range', value: position, ...limits } }))

      yield* commands.write('focuser', 'ABS_FOCUS_POSITION', { FOCUS_ABSOLUTE_POSITION: position })

      return { code: 'focusing', position } satisfies Done
    })

  return {
    focusTo: moveTo,
    focusBy: (steps: number) =>
      Effect.flatMap(focuser, reported => {
        const current = reported.ABS_FOCUS_POSITION?.values.FOCUS_ABSOLUTE_POSITION

        return current === undefined ? Effect.fail(notConnected) : moveTo(current + steps)
      }),
  }
})
