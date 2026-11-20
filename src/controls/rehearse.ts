import { SiderealTime } from 'astronomy-engine'
import { Clock, Context, Effect } from 'effect'
import type { Done, Refusal } from '../../state/commands.ts'
import type { PierSide, RehearsalId, SweepMoveBody } from '../../state/entries.ts'
import type { RigState } from '../../state/rig.ts'
import { raForHourAngle } from '../align/run.ts'
import { CommandRefused } from '../feed/commands.ts'
import { Feed } from '../feed/feed.ts'
import type { Goto, GotoResult } from '../pointing/goto.ts'
import type { Site } from '../pointing/target.ts'
import type { EquatorialOfDate } from '../sky/horizontal.ts'
import { poseOfAxes, rehearsalRoute, type Move } from '../sweep/path.ts'
import type { SweepSettings } from '../sweep/settings.ts'
import { Capturing } from './camera.ts'
import { RehearsalRunning } from './rehearsing.ts'
import { StartRunning } from './start.ts'

export class RehearsalGoto extends Context.Service<RehearsalGoto, { readonly to: (target: EquatorialOfDate) => Effect.Effect<GotoResult> }>()('vela/RehearsalGoto') {}

export class RehearsalLog extends Context.Service<
  RehearsalLog,
  {
    readonly started: (body: { readonly rehearsal: RehearsalId; readonly total: number }) => Effect.Effect<void>
    readonly moved: (body: SweepMoveBody) => Effect.Effect<void>
    readonly ended: (body: { readonly rehearsal: RehearsalId; readonly total: number; readonly ending: 'finished' | 'stopped' | 'pressed' }) => Effect.Effect<void>
  }
>()('vela/RehearsalLog') {}

export class RehearsalSettings extends Context.Service<
  RehearsalSettings,
  { readonly sweep: SweepSettings; readonly rigSilentAfterSeconds: number; readonly newId: Effect.Effect<RehearsalId> }
>()('vela/RehearsalSettings') {}

export const rehearsalGoto = (goto: Pick<Goto, 'to'>) => ({ to: (target: EquatorialOfDate) => Effect.promise(signal => goto.to(target, signal)) })

const wrapHourAngle = (degrees: number) => ((((degrees + 180) % 360) + 360) % 360) - 180

export const hourAngleOfRa = (raHours: number, site: Site, at: number) => wrapHourAngle(SiderealTime(new Date(at)) * 15 + site.longitudeDegrees - raHours * 15)

const siteReported = (rig: RigState): Site | undefined => {
  const values = rig.devices.mount.GEOGRAPHIC_COORD?.values

  return values === undefined ? undefined : { latitudeDegrees: values.LAT, longitudeDegrees: values.LONG > 180 ? values.LONG - 360 : values.LONG, elevationMeters: values.ELEV }
}

const pierSideOf = (rig: RigState): PierSide | undefined => {
  const side = rig.devices.mount.TELESCOPE_PIER_SIDE?.values

  return side?.PIER_EAST === true ? 'PIER_EAST' : side?.PIER_WEST === true ? 'PIER_WEST' : undefined
}

const outcomeOf = (result: GotoResult): Pick<SweepMoveBody, 'outcome' | 'reason'> => (result.ok ? { outcome: 'arrived' } : result.refusal === 'alert' ? { outcome: 'alert', reason: result.reason } : { outcome: 'refused', reason: result.reason })

const refusedWith = (refusal: Refusal) => Effect.fail(new CommandRefused({ refusal }))

export const rehearsalControls = Effect.gen(function* () {
  const feed = yield* Feed
  const capturing = yield* Capturing
  const starting = yield* StartRunning
  const rehearsing = yield* RehearsalRunning
  const goto = yield* RehearsalGoto
  const log = yield* RehearsalLog
  const { sweep, rigSilentAfterSeconds, newId } = yield* RehearsalSettings

  const visit = (rehearsal: RehearsalId, total: number, site: Site, move: Move, index: number) =>
    Effect.gen(function* () {
      const at = yield* Clock.currentTimeMillis
      const result = yield* goto.to({ raHours: raForHourAngle(move.pose.hourAngleDegrees, site, at), decDegrees: move.pose.declinationDegrees })
      const mount = yield* Effect.map(feed.current, rig => ({ coordinates: rig.devices.mount.EQUATORIAL_EOD_COORD?.values, side: pierSideOf(rig) }))

      yield* log.moved({
        rehearsal,
        move: index + 1,
        total,
        column: move.column,
        altitudeDegrees: move.pose.altitudeDegrees,
        azimuthDegrees: move.pose.azimuthDegrees,
        hourAngleDegrees: move.pose.hourAngleDegrees,
        declinationDegrees: move.pose.declinationDegrees,
        predictedPierSide: move.pose.predictedPierSide,
        flipExpected: move.flipExpected,
        ...outcomeOf(result),
        ...(mount.coordinates === undefined ? {} : { EQUATORIAL_EOD_COORD: { RA: mount.coordinates.RA, DEC: mount.coordinates.DEC } }),
        ...(mount.side === undefined ? {} : { TELESCOPE_PIER_SIDE: mount.side }),
      })
    })

  const routine = (rehearsal: RehearsalId, site: Site, route: ReadonlyArray<Move>) =>
    log.started({ rehearsal, total: route.length }).pipe(
      Effect.andThen(Effect.forEach(route, (move, index) => visit(rehearsal, route.length, site, move, index), { discard: true })),
      Effect.andThen(log.ended({ rehearsal, total: route.length, ending: 'finished' })),
      Effect.onInterrupt(() => Effect.flatMap(rehearsing.cancelled, ending => log.ended({ rehearsal, total: route.length, ending }))),
    )

  return {
    rehearseSweep: Effect.gen(function* () {
      const rig = yield* feed.current
      const now = yield* Clock.currentTimeMillis
      const silentSeconds = rig.heardAt === undefined ? undefined : (now - rig.heardAt) / 1000
      const site = siteReported(rig)
      const coordinates = rig.devices.mount.EQUATORIAL_EOD_COORD?.values

      if (silentSeconds === undefined || silentSeconds > rigSilentAfterSeconds) return yield* refusedWith({ code: 'rig-silent', seconds: Math.round(silentSeconds ?? 0) })
      if (rig.devices.mount.CONNECTION?.values.CONNECT !== true) return yield* refusedWith({ code: 'not-connected', device: 'mount' })
      if (site === undefined) return yield* refusedWith({ code: 'not-reported', device: 'mount', property: 'GEOGRAPHIC_COORD' })
      if (coordinates === undefined) return yield* refusedWith({ code: 'not-reported', device: 'mount', property: 'EQUATORIAL_EOD_COORD' })
      if (yield* rehearsing.busy) return yield* refusedWith({ code: 'rehearsal-active' })
      if ((yield* capturing.busy) || (yield* starting.busy)) return yield* refusedWith({ code: 'run-active' })

      const from = poseOfAxes({ hourAngleDegrees: hourAngleOfRa(coordinates.RA, site, now), declinationDegrees: coordinates.DEC }, site)
      const route = rehearsalRoute(from, site, sweep)

      yield* rehearsing.began(yield* Effect.forkDetach(routine(yield* newId, site, route)))

      return { code: 'rehearsing-sweep', moves: route.length } satisfies Done
    }),
  }
})
