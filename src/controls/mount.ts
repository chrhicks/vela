import { Context, Effect } from 'effect'
import type { NudgeDirection, NudgeId, NudgeRate } from '../../state/commands.ts'
import { Feed } from '../feed/feed.ts'
import { CommandRefused } from '../feed/commands.ts'
import { DeviceCommands } from './device-commands.ts'

export class MountRuns extends Context.Service<MountRuns, { readonly stopMoving: Effect.Effect<void> }>()('vela/MountRuns') {}

export class NudgeRates extends Context.Service<NudgeRates, Readonly<Record<NudgeRate, string>>>()('vela/NudgeRates') {}

const nudgeOf = (id: NudgeId) => `nudge-${id}`

const notConnected = new CommandRefused({ refusal: { code: 'not-connected', device: 'mount' } })

export const mountControls = Effect.gen(function* () {
  const feed = yield* Feed
  const commands = yield* DeviceCommands
  const runs = yield* MountRuns
  const rates = yield* NudgeRates

  const connected = Effect.flatMap(feed.current, rig => (rig.devices.mount.CONNECTION?.values.CONNECT === true ? Effect.void : Effect.fail(notConnected)))

  return {
    home: connected.pipe(Effect.andThen(commands.write('mount', 'TELESCOPE_HOME', { GO: true }))),
    stop: runs.stopMoving.pipe(Effect.andThen(commands.write('mount', 'TELESCOPE_ABORT_MOTION', { ABORT: true }))),
    tracking: (on: boolean) => connected.pipe(Effect.andThen(commands.write('mount', 'TELESCOPE_TRACK_STATE', { TRACK_ON: on, TRACK_OFF: !on }))),
    nudge: (id: NudgeId, direction: NudgeDirection, rate: NudgeRate) => connected.pipe(Effect.andThen(commands.ask('mount', 'nudge', nudgeOf(id), { nudge: direction, rate: rates[rate] }))),
    holdNudge: (id: NudgeId) => commands.tell('mount', { hold: nudgeOf(id) }),
    releaseNudge: (id: NudgeId) => commands.ask('mount', 'nudge release', `${nudgeOf(id)}-release`, { release: nudgeOf(id) }),
  }
})
