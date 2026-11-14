import { Context, Data, Effect, Match } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http'
import { commandsPath, CommandRequest, type Done, type FilterAnswer, type NudgeDirection, type NudgeId, type NudgeRate, type Refusal } from '../../state/commands.ts'

export class CommandRefused extends Data.TaggedError('CommandRefused')<{ readonly refusal: Refusal }> {}

export class Operations extends Context.Service<
  Operations,
  {
    readonly startAlignment: Effect.Effect<void, CommandRefused>
    readonly finishAlignment: Effect.Effect<void, CommandRefused>
    readonly answerFilter: (filter: FilterAnswer) => Effect.Effect<void, CommandRefused>
    readonly home: Effect.Effect<Done, CommandRefused>
    readonly stop: Effect.Effect<Done, CommandRefused>
    readonly tracking: (on: boolean) => Effect.Effect<Done, CommandRefused>
    readonly nudge: (id: NudgeId, direction: NudgeDirection, rate: NudgeRate) => Effect.Effect<void, CommandRefused>
    readonly holdNudge: (id: NudgeId) => Effect.Effect<void>
    readonly releaseNudge: (id: NudgeId) => Effect.Effect<void, CommandRefused>
    readonly slewAndCentre: (target: string) => Effect.Effect<Done, CommandRefused>
    readonly flipNow: Effect.Effect<Done, CommandRefused>
    readonly focusTo: (position: number) => Effect.Effect<Done, CommandRefused>
    readonly focusBy: (steps: number) => Effect.Effect<Done, CommandRefused>
    readonly autofocus: (exposureSeconds: number) => Effect.Effect<Done, CommandRefused>
    readonly coolTo: (celsius: number) => Effect.Effect<Done, CommandRefused>
    readonly coolerOff: Effect.Effect<Done, CommandRefused>
    readonly dewAuto: Effect.Effect<Done, CommandRefused>
    readonly dewFixed: (percent: number) => Effect.Effect<Done, CommandRefused>
    readonly dewOff: Effect.Effect<Done, CommandRefused>
    readonly testFrame: (exposureSeconds: number) => Effect.Effect<Done, CommandRefused>
    readonly takeDarks: (frames: number, exposureSeconds: number, celsius: number) => Effect.Effect<Done, CommandRefused>
  }
>()('vela/Operations') {}

const refused = (status: number, refusal: Refusal) => HttpServerResponse.json(refusal, { status })

const carriedOut = Effect.as<Done>({ code: 'carried-out' })

const carryOut = (request: CommandRequest): Effect.Effect<Done, CommandRefused, Operations> =>
  Effect.gen(function* () {
    const operations = yield* Operations

    return yield* Match.value(request).pipe(
      Match.discriminatorsExhaustive('command')({
        startAlignment: () => operations.startAlignment.pipe(carriedOut),
        finishAlignment: () => operations.finishAlignment.pipe(carriedOut),
        answerFilter: ({ filter }) => operations.answerFilter(filter).pipe(carriedOut),
        home: () => operations.home,
        stop: () => operations.stop,
        tracking: ({ on }) => operations.tracking(on),
        nudge: ({ id, direction, rate }) => operations.nudge(id, direction, rate).pipe(carriedOut),
        holdNudge: ({ id }) => operations.holdNudge(id).pipe(carriedOut),
        releaseNudge: ({ id }) => operations.releaseNudge(id).pipe(carriedOut),
        slewAndCentre: ({ target }) => operations.slewAndCentre(target),
        flipNow: () => operations.flipNow,
        focusTo: ({ position }) => operations.focusTo(position),
        focusBy: ({ steps }) => operations.focusBy(steps),
        autofocus: ({ exposureSeconds }) => operations.autofocus(exposureSeconds),
        coolTo: ({ celsius }) => operations.coolTo(celsius),
        coolerOff: () => operations.coolerOff,
        dewAuto: () => operations.dewAuto,
        dewFixed: ({ percent }) => operations.dewFixed(percent),
        dewOff: () => operations.dewOff,
        testFrame: ({ exposureSeconds }) => operations.testFrame(exposureSeconds),
        takeDarks: ({ frames, exposureSeconds, celsius }) => operations.takeDarks(frames, exposureSeconds, celsius),
      }),
    )
  })

export const CommandsRoute = HttpRouter.add(
  'POST',
  commandsPath,
  HttpServerRequest.schemaBodyJson(CommandRequest).pipe(
    Effect.flatMap(carryOut),
    Effect.map(done => HttpServerResponse.jsonUnsafe(done, { status: 200 })),
    Effect.catchTags({
      CommandRefused: ({ refusal }) => refused(409, refusal),
      SchemaError: () => refused(400, { code: 'malformed' }),
      HttpServerError: () => refused(400, { code: 'malformed' }),
    }),
  ),
)
