import { Clock, Context, Duration, Effect } from 'effect'
import type { Done, Refusal } from '../../state/commands.ts'
import type { FrameClass, SweepColumnBody, SweepFrameBody, SweepId, RehearsalEnding } from '../../state/entries.ts'
import { exposureMiddle, raForHourAngle } from '../align/run.ts'
import { CommandRefused } from '../feed/commands.ts'
import { Feed } from '../feed/feed.ts'
import type { Site } from '../pointing/target.ts'
import { horizontalOfDate, horizontalOfJ2000 } from '../sky/horizontal.ts'
import { baselineOf, type SolvedStars } from '../sweep/baseline.ts'
import { nextInColumn, startAltitude, type ColumnFrame } from '../sweep/column.ts'
import type { Taken } from '../sweep/frames.ts'
import { columns as columnsOf, legs, poseAt, poseOfAxes, type Column, type Pose } from '../sweep/path.ts'
import { offsetOf, pointingOf, type KnownOffset } from '../sweep/pointing.ts'
import type { SweepSettings } from '../sweep/settings.ts'
import { Capturing } from './camera.ts'
import { MountGuiding } from './mount.ts'
import { hourAngleOfRa, pierSideOf, RehearsalGoto, siteReported } from './rehearse.ts'
import { RehearsalRunning } from './rehearsing.ts'
import { StartRunning } from './start.ts'

export class SweepFrames extends Context.Service<
  SweepFrames,
  {
    readonly begin: (exposureSeconds: number) => Effect.Effect<void, CommandRefused>
    readonly take: Effect.Effect<Taken>
    readonly problems: Effect.Effect<ReadonlyArray<string>>
    readonly end: Effect.Effect<void>
  }
>()('vela/SweepFrames') {}

export class SweepLog extends Context.Service<
  SweepLog,
  {
    readonly started: (body: { readonly sweep: SweepId; readonly exposureSeconds: number; readonly columns: number }) => Effect.Effect<void>
    readonly framed: (body: SweepFrameBody) => Effect.Effect<void>
    readonly columned: (body: SweepColumnBody) => Effect.Effect<void>
    readonly alerted: (body: { readonly sweep: SweepId; readonly column: number; readonly text: string }) => Effect.Effect<void>
    readonly ended: (body: { readonly sweep: SweepId; readonly columns: number; readonly ending: RehearsalEnding }) => Effect.Effect<void>
  }
>()('vela/SweepLog') {}

export class SweepRecord extends Context.Service<SweepRecord, { readonly append: (record: 'frames' | 'columns', at: number, line: SweepFrameBody | SweepColumnBody) => Effect.Effect<void, string> }>()('vela/SweepRecord') {}

export class SweepRunSettings extends Context.Service<SweepRunSettings, { readonly sweep: SweepSettings; readonly rigSilentAfterSeconds: number; readonly newId: Effect.Effect<SweepId> }>()('vela/SweepRunSettings') {}

const refusedWith = (refusal: Refusal) => Effect.fail(new CommandRefused({ refusal }))

const headerCards = (header: Readonly<Record<string, string | number | boolean>>) => Object.entries(header).map(([key, value]) => ({ key, value: String(value), comment: '' }))

export const sweepControls = Effect.gen(function* () {
  const feed = yield* Feed
  const capturing = yield* Capturing
  const starting = yield* StartRunning
  const running = yield* RehearsalRunning
  const goto = yield* RehearsalGoto
  const guider = yield* MountGuiding
  const frames = yield* SweepFrames
  const log = yield* SweepLog
  const record = yield* SweepRecord
  const { sweep, rigSilentAfterSeconds, newId } = yield* SweepRunSettings

  const alert = (id: SweepId, column: number, text: string) => log.alerted({ sweep: id, column, text })

  const keepRecord = (id: SweepId, column: number, which: 'frames' | 'columns', at: number, body: SweepFrameBody | SweepColumnBody) =>
    record.append(which, at, body).pipe(Effect.catch(reason => alert(id, column, `the ${which} record could not be written: ${reason}`)))

  const moveTo = (id: SweepId, column: number, site: Site, from: Pose, to: Pose) =>
    Effect.gen(function* () {
      const chain = legs(from, to, site, sweep)
      let problem: string | undefined
      let target = { raHours: 0, decDegrees: 0 }

      for (const [index, pose] of chain.entries()) {
        const at = yield* Clock.currentTimeMillis

        target = { raHours: raForHourAngle(pose.hourAngleDegrees, site, at), decDegrees: pose.declinationDegrees }

        const result = yield* goto.to(target)

        problem = result.ok ? undefined : result.reason

        if (problem !== undefined && index < chain.length - 1) yield* alert(id, column, `a step of the move was not made: ${problem}`)
      }

      return { target, problem }
    })

  const routine = (id: SweepId, site: Site, exposureSeconds: number, route: ReadonlyArray<Column>, from: Pose) =>
    Effect.gen(function* () {
      const solvedStars: Array<SolvedStars> = []
      const offsets: Array<KnownOffset> = []
      let at = from
      let start: number | undefined
      let southStart: number | undefined
      let finished = 0

      yield* log.started({ sweep: id, exposureSeconds, columns: route.length })

      for (const [column, { azimuthDegrees, half }] of route.entries()) {
        const inColumn: Array<ColumnFrame> = []
        const previousHalf = route[column - 1]?.half

        if (previousHalf === 'east' && half === 'west') start = southStart

        let altitude = startAltitude(start, sweep)
        let alerted = false

        while (true) {
          const pose = poseAt(altitude, azimuthDegrees, site)
          const moved = yield* moveTo(id, column, site, at, pose)

          at = pose

          if (moved.problem !== undefined) yield* alert(id, column, `the move to altitude ${altitude.toFixed(1)}° azimuth ${azimuthDegrees.toFixed(1)}° was not made: ${moved.problem}`)

          yield* Effect.sleep(Duration.seconds(sweep.settleSeconds))

          const reported = yield* Effect.map(feed.current, rig => ({ coordinates: rig.devices.mount.EQUATORIAL_EOD_COORD?.values, pierSide: pierSideOf(rig) }))
          const taken = yield* frames.take

          for (const problem of yield* frames.problems) yield* alert(id, column, problem)

          if (taken.taken === 'ended') {
            yield* alert(id, column, `the sweep cannot go on: ${taken.reason}`)

            return { ending: 'stopped' as const, finished }
          }

          if (taken.taken === 'failed') {
            yield* alert(id, column, `a frame was not taken: ${taken.reason}`)
            continue
          }

          const now = yield* Clock.currentTimeMillis
          const when = taken.taken === 'measured' ? (exposureMiddle(headerCards(taken.answer.header)) ?? now) : now
          const solve = taken.taken === 'measured' ? taken.answer.solve : undefined
          const solved = solve?.solved === true ? solve : undefined
          const commanded = horizontalOfDate(moved.target, when, site)
          const solvedHorizontal = solved === undefined ? undefined : horizontalOfJ2000(solved, when, site)
          const pointing = pointingOf({ solved: solvedHorizontal, commanded, pierSide: reported.pierSide }, offsets)

          if (solvedHorizontal !== undefined) offsets.push({ pierSide: reported.pierSide, offset: offsetOf(solvedHorizontal, commanded) })

          const stars = taken.taken === 'measured' && taken.answer.stars?.measured === true ? taken.answer.stars.count : 0
          const starsReason = taken.taken === 'refused' ? `the rig program did not measure it: ${taken.reason}` : taken.answer.stars?.measured === false ? taken.answer.stars.reason : undefined
          const baseline = baselineOf(solvedStars, pointing.altitudeDegrees, sweep)
          const frameClass: FrameClass = solved !== undefined ? 'sky' : 'blocked'

          if (solved !== undefined) solvedStars.push({ altitudeDegrees: pointing.altitudeDegrees, stars })

          if (taken.taken === 'refused') yield* alert(id, column, `the frame ${taken.file} was not measured: ${taken.reason}`)

          const body: SweepFrameBody = {
            sweep: id,
            column,
            azimuthDegrees,
            file: taken.file,
            at: when,
            commanded: { altitudeDegrees: pose.altitudeDegrees, azimuthDegrees: pose.azimuthDegrees, hourAngleDegrees: pose.hourAngleDegrees, declinationDegrees: pose.declinationDegrees },
            ...(reported.coordinates === undefined ? {} : { EQUATORIAL_EOD_COORD: { RA: reported.coordinates.RA, DEC: reported.coordinates.DEC } }),
            ...(reported.pierSide === undefined ? {} : { TELESCOPE_PIER_SIDE: reported.pierSide }),
            ...(moved.problem === undefined ? {} : { moveProblem: moved.problem }),
            solve:
              solved !== undefined
                ? { solved: true, raDegrees: solved.raDegrees, decDegrees: solved.decDegrees, ...(solved.rotationDegrees === undefined ? {} : { rotationDegrees: solved.rotationDegrees }), ...(solved.scaleArcsecPerPixel === undefined ? {} : { scaleArcsecPerPixel: solved.scaleArcsecPerPixel }) }
                : { solved: false, reason: solve?.solved === false ? solve.reason : taken.taken === 'refused' ? `the rig program did not measure it: ${taken.reason}` : 'the rig program sent no solve' },
            stars,
            ...(starsReason === undefined ? {} : { starsReason }),
            ...(baseline === undefined ? {} : { baseline }),
            class: frameClass,
            pointing: { source: pointing.source, altitudeDegrees: pointing.altitudeDegrees, azimuthDegrees: pointing.azimuthDegrees },
          }

          yield* log.framed(body)
          yield* keepRecord(id, column, 'frames', when, body)

          inColumn.push({ commandedAltitudeDegrees: pose.altitudeDegrees, altitudeDegrees: pointing.altitudeDegrees, class: frameClass })

          if (inColumn.length === sweep.alertAfterFrames && !alerted) {
            alerted = true
            yield* alert(id, column, `${inColumn.length} frames in column ${column + 1} and no edge yet`)
          }

          const step = nextInColumn(inColumn, sweep)

          if (step.step === 'frame') {
            altitude = step.altitudeDegrees
            continue
          }

          const done: SweepColumnBody = { sweep: id, column, azimuthDegrees, edgeAltitudeDegrees: step.edgeAltitudeDegrees, how: step.how, frames: inColumn.length }

          yield* log.columned(done)
          yield* keepRecord(id, column, 'columns', when, done)

          start = step.startAltitudeDegrees

          if (southStart === undefined && half === 'east') southStart = start

          finished = column + 1

          break
        }
      }

      return { ending: 'finished' as const, finished }
    }).pipe(
      Effect.flatMap(({ ending, finished }) => frames.end.pipe(Effect.andThen(Effect.flatMap(frames.problems, found => Effect.forEach(found, text => alert(id, finished, text), { discard: true }))), Effect.andThen(log.ended({ sweep: id, columns: finished, ending })))),
      Effect.onInterrupt(() => Effect.flatMap(running.cancelled, ending => frames.end.pipe(Effect.andThen(log.ended({ sweep: id, columns: 0, ending }))))),
    )

  return {
    startSweep: (exposureSeconds: number) =>
      Effect.gen(function* () {
        const rig = yield* feed.current
        const now = yield* Clock.currentTimeMillis
        const silentSeconds = rig.heardAt === undefined ? undefined : (now - rig.heardAt) / 1000
        const site = siteReported(rig)
        const coordinates = rig.devices.mount.EQUATORIAL_EOD_COORD?.values

        if (silentSeconds === undefined || silentSeconds > rigSilentAfterSeconds) return yield* refusedWith({ code: 'rig-silent', seconds: Math.round(silentSeconds ?? 0) })
        if (rig.devices.mount.CONNECTION?.values.CONNECT !== true) return yield* refusedWith({ code: 'not-connected', device: 'mount' })
        if (site === undefined) return yield* refusedWith({ code: 'not-reported', device: 'mount', property: 'GEOGRAPHIC_COORD' })
        if (coordinates === undefined) return yield* refusedWith({ code: 'not-reported', device: 'mount', property: 'EQUATORIAL_EOD_COORD' })
        if (yield* running.busy) return yield* refusedWith({ code: (yield* running.which) === 'sweep' ? 'sweep-active' : 'rehearsal-active' })
        if ((yield* capturing.busy) || (yield* starting.busy)) return yield* refusedWith({ code: 'run-active' })

        const stoppedGuiding = yield* guider.stop

        yield* frames.begin(exposureSeconds)

        const from = poseOfAxes({ hourAngleDegrees: hourAngleOfRa(coordinates.RA, site, now), declinationDegrees: coordinates.DEC }, site)
        const route = columnsOf({ columnDegrees: sweep.columnDegrees })

        yield* running.began(yield* Effect.forkDetach(routine(yield* newId, site, exposureSeconds, route, from)), 'sweep')

        return { code: 'sweeping', columns: route.length, exposureSeconds, stoppedGuiding } satisfies Done
      }),
  }
})
