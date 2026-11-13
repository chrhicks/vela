import { Context, Effect } from 'effect'
import type { Done } from '../../state/commands.ts'
import { operationObjects } from '../../state/entries.ts'
import { sequenceName, type CaptureRequest } from '../capture/request.ts'
import { CommandRefused } from '../feed/commands.ts'
import { Feed } from '../feed/feed.ts'
import { DeviceCommands } from './device-commands.ts'

export class Capturing extends Context.Service<Capturing, { readonly busy: Effect.Effect<boolean>; readonly start: (request: CaptureRequest) => Effect.Effect<void, CommandRefused> }>()('vela/Capturing') {}

const notConnected = new CommandRefused({ refusal: { code: 'not-connected', device: 'primary' } })

export const cameraControls = Effect.gen(function* () {
  const feed = yield* Feed
  const commands = yield* DeviceCommands
  const capturing = yield* Capturing

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
    testFrame: (exposureSeconds: number) =>
      Effect.gen(function* () {
        const controls = (yield* camera).CCD_CONTROLS?.values
        const gain = controls?.['Gain']
        const offset = controls?.['Offset']

        if (gain === undefined || offset === undefined) return yield* Effect.fail(notConnected)
        if (yield* capturing.busy) return yield* Effect.fail(new CommandRefused({ refusal: { code: 'run-active' } }))

        const request: CaptureRequest = { object: operationObjects.test, frameType: 'light', exposureSeconds, count: 1, gain, offset, cooler: 'keep' }

        yield* capturing.start(request)

        return { code: 'test-frame', exposureSeconds, sequence: sequenceName(request.object, request.frameType) ?? request.object } satisfies Done
      }),
    coolerOff: camera.pipe(Effect.andThen(commands.write('primary', 'CCD_COOLER', { COOLER_ON: false, COOLER_OFF: true })), Effect.as<Done>({ code: 'cooler-off' })),
  }
})
