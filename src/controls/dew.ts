import { Context, Effect } from 'effect'
import type { Done } from '../../state/commands.ts'
import { CommandRefused } from '../feed/commands.ts'
import { Feed } from '../feed/feed.ts'
import { DeviceCommands } from './device-commands.ts'

export class DewSettings extends Context.Service<DewSettings, { readonly channel: string }>()('vela/DewSettings') {}

const notConnected = new CommandRefused({ refusal: { code: 'not-connected', device: 'box' } })

export const dewControls = Effect.gen(function* () {
  const feed = yield* Feed
  const commands = yield* DeviceCommands
  const { channel } = yield* DewSettings

  const box = Effect.flatMap(feed.current, rig => {
    const reported = rig.devices.box

    return reported.CONNECTION?.values.CONNECT === true ? Effect.succeed(reported) : Effect.fail(notConnected)
  })

  const automatic = (on: boolean) =>
    Effect.flatMap(box, reported => {
      const switches = Object.keys(reported.AUTO_DEW_CONTROL?.values ?? {})

      return switches.length === 0 ? Effect.fail(notConnected) : commands.write('box', 'AUTO_DEW_CONTROL', Object.fromEntries(switches.map(name => [name, on])))
    })

  const output = (on: boolean) => commands.write('box', 'DEW_CHANNELS', { [channel]: on })

  return {
    dewAuto: automatic(true).pipe(Effect.andThen(output(true)), Effect.as<Done>({ code: 'dew-auto' })),
    dewFixed: (percent: number) =>
      Effect.gen(function* () {
        const limits = (yield* box).DEW_DUTY_CYCLES?.limits?.[channel]

        if (limits !== undefined && (percent < limits.min || percent > limits.max)) return yield* Effect.fail(new CommandRefused({ refusal: { code: 'out-of-range', value: percent, ...limits } }))

        yield* automatic(false)
        yield* commands.write('box', 'DEW_DUTY_CYCLES', { [channel]: percent })
        yield* output(true)

        return { code: 'dew-fixed', percent } satisfies Done
      }),
    dewOff: automatic(false).pipe(Effect.andThen(output(false)), Effect.as<Done>({ code: 'dew-off' })),
  }
})
