import { Effect } from 'effect'
import type { Done } from '../../state/commands.ts'
import { CommandRefused } from '../feed/commands.ts'
import { Feed } from '../feed/feed.ts'
import { DeviceCommands } from './device-commands.ts'

const notConnected = new CommandRefused({ refusal: { code: 'not-connected', device: 'primary' } })

export const cameraControls = Effect.gen(function* () {
  const feed = yield* Feed
  const commands = yield* DeviceCommands

  const camera = Effect.flatMap(feed.current, rig => {
    const reported = rig.devices.primary

    return reported.CONNECTION?.values.CONNECT === true ? Effect.succeed(reported) : Effect.fail(notConnected)
  })

  return {
    coolTo: (celsius: number) =>
      Effect.gen(function* () {
        const limits = (yield* camera).CCD_TEMPERATURE?.limits?.['CCD_TEMPERATURE_VALUE']

        if (limits !== undefined && (celsius < limits.min || celsius > limits.max)) return yield* Effect.fail(new CommandRefused({ refusal: { code: 'out-of-range', value: celsius, ...limits } }))

        yield* commands.write('primary', 'CCD_TEMPERATURE', { CCD_TEMPERATURE_VALUE: celsius })
        yield* commands.write('primary', 'CCD_COOLER', { COOLER_ON: true, COOLER_OFF: false })

        return { code: 'cooling', celsius } satisfies Done
      }),
    coolerOff: camera.pipe(Effect.andThen(commands.write('primary', 'CCD_COOLER', { COOLER_ON: false, COOLER_OFF: true })), Effect.as<Done>({ code: 'cooler-off' })),
  }
})
