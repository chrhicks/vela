import { Context, Duration, Effect, Option, Result, Stream } from 'effect'
import type { Done } from '../../state/commands.ts'
import { operationObjects, readRigEntry, type FlatVerdict } from '../../state/entries.ts'
import type { Entry } from '../../state/entry.ts'
import { sequenceName, type CaptureRequest } from '../capture/request.ts'
import { CommandRefused } from '../feed/commands.ts'
import { Feed } from '../feed/feed.ts'
import { Capturing } from './camera.ts'

export interface FlatTry {
  readonly exposureSeconds: number
  readonly sky?: number
  readonly verdict: FlatVerdict
  readonly nextSeconds?: number
}

export class FlatsLog extends Context.Service<FlatsLog, { readonly tried: (flatTry: FlatTry) => Effect.Effect<void> }>()('vela/FlatsLog') {}

export class FlatSettings extends Context.Service<
  FlatSettings,
  { readonly startSeconds: number; readonly lowAdu: number; readonly highAdu: number; readonly minSeconds: number; readonly maxSeconds: number; readonly tries: number; readonly measureSeconds: number }
>()('vela/FlatSettings') {}

const notConnected = new CommandRefused({ refusal: { code: 'not-connected', device: 'primary' } })

const testSequence = sequenceName(operationObjects.flatExposure, 'flat')

const skyOfTest = (entry: Entry): Result.Result<number, Entry> =>
  Result.match(readRigEntry(entry), {
    onFailure: () => Result.fail(entry),
    onSuccess: found => {
      const measured = Option.getOrUndefined(found)

      return measured?.kind === 'vela.frame.stats' && measured.body.file.startsWith(`${testSequence}_`) ? Result.succeed(measured.body.sky) : Result.fail(entry)
    },
  })

export const flatControls = Effect.gen(function* () {
  const feed = yield* Feed
  const capturing = yield* Capturing
  const log = yield* FlatsLog
  const settings = yield* FlatSettings
  const target = (settings.lowAdu + settings.highAdu) / 2

  const nextOf = (exposureSeconds: number, sky: number): { readonly verdict: FlatVerdict; readonly nextSeconds?: number } => {
    if (sky >= settings.lowAdu && sky <= settings.highAdu) return { verdict: 'good' }

    const nextSeconds = sky <= 0 ? Number.POSITIVE_INFINITY : Number(((exposureSeconds * target) / sky).toPrecision(3))

    if (nextSeconds > settings.maxSeconds) return { verdict: 'too-dark' }
    if (nextSeconds < settings.minSeconds) return { verdict: 'too-bright' }

    return { verdict: 'trying', nextSeconds }
  }

  const exposureFrom = (camera: Pick<CaptureRequest, 'gain' | 'offset'>, celsius: number, exposureSeconds: number, taken: number): Effect.Effect<Option.Option<number>> =>
    Effect.scoped(
      Effect.gen(function* () {
        const { entries } = yield* feed.subscribe
        const cooler: Pick<CaptureRequest, 'cooler' | 'setpoint' | 'waitForSetpoint'> = taken === 0 ? { cooler: 'on', setpoint: celsius, waitForSetpoint: true } : { cooler: 'keep' }
        const started = yield* Effect.result(capturing.start({ object: operationObjects.flatExposure, frameType: 'flat', exposureSeconds, count: 1, ...camera, ...cooler }))
        const ending = Result.isFailure(started) ? undefined : yield* capturing.finished

        if (ending !== 'done') return yield* log.tried({ exposureSeconds, verdict: 'stopped' }).pipe(Effect.as(Option.none<number>()))

        const measured = yield* entries.pipe(Stream.filterMap(skyOfTest), Stream.runHead, Effect.timeoutOption(Duration.seconds(settings.measureSeconds)), Effect.map(Option.flatten))

        if (Option.isNone(measured)) return yield* log.tried({ exposureSeconds, verdict: 'not-measured' }).pipe(Effect.as(Option.none<number>()))

        const sky = measured.value
        const next = nextOf(exposureSeconds, sky)

        if (next.nextSeconds !== undefined && taken + 1 >= settings.tries) return yield* log.tried({ exposureSeconds, sky, verdict: 'gave-up' }).pipe(Effect.as(Option.none<number>()))

        yield* log.tried({ exposureSeconds, sky, ...next })

        if (next.verdict === 'good') return Option.some(exposureSeconds)

        return next.nextSeconds === undefined ? Option.none<number>() : yield* exposureFrom(camera, celsius, next.nextSeconds, taken + 1)
      }),
    )

  return {
    takeFlats: (frames: number, celsius: number) =>
      Effect.gen(function* () {
        const reported = (yield* feed.current).devices.primary

        if (reported.CONNECTION?.values.CONNECT !== true) return yield* Effect.fail(notConnected)

        const gain = reported.CCD_CONTROLS?.values.Gain
        const offset = reported.CCD_CONTROLS?.values.Offset
        const limits = reported.CCD_TEMPERATURE?.limits?.['CCD_TEMPERATURE_VALUE']

        if (gain === undefined || offset === undefined) return yield* Effect.fail(notConnected)
        if (limits !== undefined && (celsius < limits.min || celsius > limits.max)) return yield* Effect.fail(new CommandRefused({ refusal: { code: 'out-of-range', value: celsius, ...limits } }))
        if (yield* capturing.busy) return yield* Effect.fail(new CommandRefused({ refusal: { code: 'run-active' } }))

        const set = (exposureSeconds: number) => capturing.start({ object: 'flat', frameType: 'flat', exposureSeconds, count: frames, gain, offset, cooler: 'on', setpoint: celsius, waitForSetpoint: true })

        yield* exposureFrom({ gain, offset }, celsius, settings.startSeconds, 0).pipe(
          Effect.flatMap(Option.match({ onNone: () => Effect.void, onSome: set })),
          Effect.ignore,
          Effect.forkDetach,
        )

        return { code: 'flats', frames, celsius } satisfies Done
      }),
  }
})
