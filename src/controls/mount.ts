import { Effect } from 'effect'
import { Feed } from '../feed/feed.ts'
import { CommandRefused } from '../feed/commands.ts'
import { DeviceCommands } from './device-commands.ts'

const notConnected = new CommandRefused({ refusal: { code: 'not-connected', device: 'mount' } })

export const mountControls = Effect.gen(function* () {
  const feed = yield* Feed
  const commands = yield* DeviceCommands

  const connected = Effect.flatMap(feed.current, rig => (rig.devices.mount.CONNECTION?.values.CONNECT === true ? Effect.void : Effect.fail(notConnected)))

  return {
    home: connected.pipe(Effect.andThen(commands.write('mount', 'TELESCOPE_HOME', { GO: true }))),
  }
})
