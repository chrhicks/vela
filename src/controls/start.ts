import { Clock, Context, Duration, Effect, Fiber, Option, Result, Stream } from 'effect'
import type { CaptureRequest } from '../capture/request.ts'
import { positionId } from '../catalog/position.ts'
import type { CatalogTarget } from '../catalog/types.ts'
import type { EquatorialPosition } from '../sky/coordinates.ts'
import type { Done, FilterAnswer, NightStep, Refusal } from '../../state/commands.ts'
import { isGuiderReport, readRigEntry, type StartId, type StartStep, type TargetStepBody } from '../../state/entries.ts'
import type { Entry } from '../../state/entry.ts'
import type { RunTarget } from '../../state/targets.ts'
import { CommandRefused } from '../feed/commands.ts'
import { Feed } from '../feed/feed.ts'
import { Capturing } from './camera.ts'
import { DeviceCommands } from './device-commands.ts'
import { Autofocusing } from './focus.ts'
import { guidingControls } from './guiding.ts'
import { MountRuns } from './mount.ts'
import { endOfMove } from './settle.ts'

export class TargetCatalog extends Context.Service<TargetCatalog, { readonly find: (id: string) => CatalogTarget | undefined }>()('vela/TargetCatalog') {}

export class TargetCentring extends Context.Service<TargetCentring, { readonly centre: (id: string) => Effect.Effect<void, CommandRefused> }>()('vela/TargetCentring') {}

export class StartLog extends Context.Service<StartLog, { readonly report: (step: TargetStepBody) => Effect.Effect<void> }>()('vela/StartLog') {}

export class StartRunning extends Context.Service<StartRunning, { readonly busy: Effect.Effect<boolean>; readonly began: (routine: Fiber.Fiber<void>) => Effect.Effect<void> }>()('vela/StartRunning') {}

export class StartSettings extends Context.Service<
  StartSettings,
  {
    readonly homeSeconds: number
    readonly guidingSeconds: number
    readonly rigSilentAfterSeconds: number
    readonly autofocusExposureSeconds: Readonly<Record<FilterAnswer, number>>
    readonly newId: Effect.Effect<StartId>
  }
>()('vela/StartSettings') {}

type Step = readonly [name: StartStep, work: Effect.Effect<unknown, CommandRefused>]

const refusedWith = (refusal: Refusal) => Effect.fail(new CommandRefused({ refusal }))

const asciiName = (name: string) => name.replaceAll('°', 'd').replaceAll('′', 'm').replaceAll('″', 's')

const settled = (entry: Entry): Result.Result<{ readonly status: number | string | undefined; readonly error: string | undefined }, Entry> =>
  Result.match(readRigEntry(entry), {
    onFailure: () => Result.fail(entry),
    onSuccess: found => {
      const reported = Option.getOrUndefined(found)

      return reported !== undefined && isGuiderReport(reported) && reported.body.Event === 'SettleDone' ? Result.succeed({ status: reported.body.Status, error: reported.body.Error }) : Result.fail(entry)
    },
  })

export const startControls = Effect.gen(function* () {
  const feed = yield* Feed
  const commands = yield* DeviceCommands
  const capturing = yield* Capturing
  const centring = yield* TargetCentring
  const autofocusing = yield* Autofocusing
  const catalog = yield* TargetCatalog
  const log = yield* StartLog
  const running = yield* StartRunning
  const guiding = yield* guidingControls
  const runs = yield* MountRuns
  const { homeSeconds, guidingSeconds, rigSilentAfterSeconds, autofocusExposureSeconds, newId } = yield* StartSettings

  const operationDone = (what: string) => Effect.flatMap(capturing.finished, reason => (reason === 'done' ? Effect.void : refusedWith({ code: 'refused', text: `${what} ended ${reason ?? 'with no word'}` })))

  const home = Effect.scoped(
    Effect.gen(function* () {
      const { entries } = yield* feed.subscribe

      yield* commands.write('mount', 'TELESCOPE_HOME', { GO: true })

      const ended = yield* endOfMove(entries, 'mount', 'TELESCOPE_HOME', homeSeconds)

      if (Option.isNone(ended)) return yield* refusedWith({ code: 'no-answer', seconds: homeSeconds })
      if (ended.value === 'Alert') return yield* refusedWith({ code: 'move-failed', device: 'mount' })
    }),
  )

  const autofocus = Effect.gen(function* () {
    const filter = (yield* feed.current).operations.filter ?? 'out'

    yield* autofocusing.start(autofocusExposureSeconds[filter])
    yield* operationDone('autofocus')
  })

  const guide = Effect.scoped(
    Effect.gen(function* () {
      const { entries } = yield* feed.subscribe

      yield* guiding.startGuiding

      const settle = yield* entries.pipe(Stream.filterMap(settled), Stream.runHead, Effect.timeoutOption(Duration.seconds(guidingSeconds)), Effect.map(Option.flatten))

      if (Option.isNone(settle)) return yield* refusedWith({ code: 'guider-silent', seconds: guidingSeconds })
      if (settle.value.status !== 0) return yield* refusedWith({ code: 'guider-refused', text: settle.value.error ?? 'guiding did not settle' })
    }),
  )

  const routine = (start: StartId, target: RunTarget, steps: ReadonlyArray<Step>) =>
    Effect.forEach(
      steps,
      ([step, work]) => {
        const report = (outcome: TargetStepBody['outcome'], refusal?: Refusal) => log.report({ start, target, step, outcome, ...(refusal === undefined ? {} : { refusal }) })

        return report('started').pipe(
          Effect.andThen(Effect.result(work)),
          Effect.flatMap(Result.match({ onSuccess: () => report('done'), onFailure: ({ refusal }) => report('failed', refusal) })),
          Effect.onInterrupt(() => report('stopped')),
        )
      },
      { discard: true },
    )

  const nightSteps: ReadonlyArray<readonly [NightStep, Effect.Effect<unknown, CommandRefused>]> = [
    ['guiding', guiding.stopGuiding],
    ['home', home],
    ['tracking', commands.write('mount', 'TELESCOPE_TRACK_STATE', { TRACK_ON: false, TRACK_OFF: true })],
    ['cooler', commands.write('primary', 'CCD_COOLER', { COOLER_ON: false, COOLER_OFF: true })],
  ]

  return {
    stopForTheNight: Effect.gen(function* () {
      const endedRun = yield* runs.endRun
      const missed = yield* Effect.forEach(nightSteps, ([step, work]) => Effect.map(Effect.result(work), done => (Result.isFailure(done) ? [step] : [])))

      return { code: 'stopped-for-night', endedRun, missed: missed.flat() } satisfies Done
    }),
    startTarget: (id: string, exposureSeconds: number, frames: number | undefined, centre: EquatorialPosition | undefined) =>
      Effect.gen(function* () {
        const found = catalog.find(id)

        if (found === undefined) return yield* refusedWith({ code: 'unknown-target', text: id })

        const rig = yield* feed.current
        const now = yield* Clock.currentTimeMillis
        const silentSeconds = rig.heardAt === undefined ? undefined : (now - rig.heardAt) / 1000
        const controls = rig.devices.primary.CCD_CONTROLS?.values
        const gain = controls?.Gain
        const offset = controls?.Offset

        if (silentSeconds === undefined || silentSeconds > rigSilentAfterSeconds) return yield* refusedWith({ code: 'rig-silent', seconds: Math.round(silentSeconds ?? 0) })
        if (rig.devices.mount.CONNECTION?.values.CONNECT !== true) return yield* refusedWith({ code: 'not-connected', device: 'mount' })
        if (gain === undefined || offset === undefined) return yield* refusedWith({ code: 'not-connected', device: 'primary' })
        if ((yield* capturing.busy) || (yield* running.busy)) return yield* refusedWith({ code: 'run-active' })

        const name = asciiName(found.name)
        const target: RunTarget = { id: found.id, name, raDegrees: found.raDegrees, decDegrees: found.decDegrees }
        const request: CaptureRequest = { object: name, frameType: 'light', exposureSeconds, ...(frames === undefined ? {} : { count: frames }), gain, offset, cooler: 'keep', target }

        const steps: ReadonlyArray<Step> = [
          ['home', home],
          ['stop-guiding', guiding.stopGuiding],
          ['centre', centring.centre(centre === undefined ? found.id : positionId(centre)).pipe(Effect.andThen(operationDone('centring')))],
          ['autofocus', autofocus],
          ['guiding', guide],
          ['capture', capturing.start(request)],
        ]

        yield* running.began(yield* Effect.forkDetach(routine(yield* newId, target, steps)))

        return { code: 'starting-target', name, exposureSeconds, ...(frames === undefined ? {} : { frames }) } satisfies Done
      }),
  }
})
