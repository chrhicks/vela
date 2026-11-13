import { Context, Effect, Option } from 'effect'
import type { Done, NudgeDirection, NudgeId, NudgeRate } from '../../state/commands.ts'
import type { RigState } from '../../state/rig.ts'
import { Feed } from '../feed/feed.ts'
import { CommandRefused } from '../feed/commands.ts'
import { DeviceCommands } from './device-commands.ts'
import { endOfMove } from './settle.ts'

export class MountRuns extends Context.Service<
  MountRuns,
  {
    readonly endRun: Effect.Effect<boolean>
    readonly idle: Effect.Effect<void>
    readonly pause: Effect.Effect<boolean>
    readonly resume: Effect.Effect<void>
  }
>()('vela/MountRuns') {}

export class Centring extends Context.Service<Centring, { readonly centreOn: (target: string) => Effect.Effect<string, CommandRefused> }>()('vela/Centring') {}

export class MountSettings extends Context.Service<MountSettings, { readonly nudgeRates: Readonly<Record<NudgeRate, string>>; readonly flipSettleSeconds: number }>()('vela/MountSettings') {}

const pierSideOf = (rig: RigState) => {
  const side = rig.devices.mount.TELESCOPE_PIER_SIDE?.values

  return side?.PIER_EAST === true ? 'east' : side?.PIER_WEST === true ? 'west' : undefined
}

const nudgeOf = (id: NudgeId) => `nudge-${id}`

const notConnected = new CommandRefused({ refusal: { code: 'not-connected', device: 'mount' } })

export const mountControls = Effect.gen(function* () {
  const feed = yield* Feed
  const commands = yield* DeviceCommands
  const runs = yield* MountRuns
  const { nudgeRates, flipSettleSeconds } = yield* MountSettings
  const centring = yield* Centring

  const connected = Effect.flatMap(feed.current, rig => (rig.devices.mount.CONNECTION?.values.CONNECT === true ? Effect.void : Effect.fail(notConnected)))

  return {
    home: Effect.gen(function* () {
      yield* connected

      const endedRun = yield* runs.endRun

      yield* commands.write('mount', 'TELESCOPE_HOME', { GO: true })

      return { code: 'home', endedRun } satisfies Done
    }),
    stop: Effect.gen(function* () {
      const endedRun = yield* runs.endRun

      yield* commands.write('mount', 'TELESCOPE_ABORT_MOTION', { ABORT: true })

      return { code: 'stop', endedRun } satisfies Done
    }),
    tracking: (on: boolean) => connected.pipe(Effect.andThen(commands.write('mount', 'TELESCOPE_TRACK_STATE', { TRACK_ON: on, TRACK_OFF: !on })), Effect.as<Done>({ code: 'tracking', on })),
    nudge: (id: NudgeId, direction: NudgeDirection, rate: NudgeRate) => connected.pipe(Effect.andThen(commands.ask('mount', 'nudge', nudgeOf(id), { nudge: direction, rate: nudgeRates[rate] }))),
    holdNudge: (id: NudgeId) => commands.tell('mount', { hold: nudgeOf(id) }),
    slewAndCentre: (target: string) =>
      Effect.gen(function* () {
        yield* connected

        const endedRun = yield* runs.endRun

        yield* runs.idle

        const name = yield* centring.centreOn(target)

        return { code: 'centring', target: name, endedRun } satisfies Done
      }),
    flipNow: Effect.scoped(
      Effect.gen(function* () {
        yield* connected

        const before = yield* feed.current
        const pointing = before.devices.mount.EQUATORIAL_EOD_COORD?.values

        if (pointing === undefined) return yield* Effect.fail(notConnected)

        const { entries } = yield* feed.subscribe
        const pausedRun = yield* runs.pause

        yield* commands.write('mount', 'ON_COORD_SET', { SLEW: false, TRACK: true, SYNC: false }).pipe(
          Effect.andThen(commands.write('mount', 'EQUATORIAL_EOD_COORD', { RA: pointing.RA, DEC: pointing.DEC })),
          Effect.tapError(() => runs.resume),
        )

        const settled = Option.isSome(yield* endOfMove(entries, 'mount', 'EQUATORIAL_EOD_COORD', flipSettleSeconds))

        yield* runs.resume

        const after = pierSideOf(yield* feed.current)
        const flipped = after !== undefined && after !== pierSideOf(before)

        return { code: 'flip', settled, flipped, pausedRun, ...(after === undefined ? {} : { pierSide: after }) } satisfies Done
      }),
    ),
    releaseNudge: (id: NudgeId) => commands.ask('mount', 'nudge release', `${nudgeOf(id)}-release`, { release: nudgeOf(id) }),
  }
})
