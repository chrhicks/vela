import { Context, Data, Effect, Match } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http'
import { commandsPath, CommandRequest, type FilterAnswer, type Refusal } from '../../state/commands.ts'

export class CommandRefused extends Data.TaggedError('CommandRefused')<{ readonly refusal: Refusal }> {}

export class Operations extends Context.Service<
  Operations,
  {
    readonly startAlignment: Effect.Effect<void, CommandRefused>
    readonly finishAlignment: Effect.Effect<void, CommandRefused>
    readonly answerFilter: (filter: FilterAnswer) => Effect.Effect<void, CommandRefused>
    readonly home: Effect.Effect<void, CommandRefused>
    readonly stop: Effect.Effect<void, CommandRefused>
    readonly tracking: (on: boolean) => Effect.Effect<void, CommandRefused>
  }
>()('vela/Operations') {}

const refused = (status: number, refusal: Refusal) => HttpServerResponse.json(refusal, { status })

const carryOut = (request: CommandRequest) =>
  Effect.gen(function* () {
    const operations = yield* Operations

    return yield* Match.value(request).pipe(
      Match.discriminatorsExhaustive('command')({
        startAlignment: () => operations.startAlignment,
        finishAlignment: () => operations.finishAlignment,
        answerFilter: ({ filter }) => operations.answerFilter(filter),
        home: () => operations.home,
        stop: () => operations.stop,
        tracking: ({ on }) => operations.tracking(on),
      }),
    )
  })

export const CommandsRoute = HttpRouter.add(
  'POST',
  commandsPath,
  HttpServerRequest.schemaBodyJson(CommandRequest).pipe(
    Effect.flatMap(carryOut),
    Effect.as(HttpServerResponse.empty({ status: 202 })),
    Effect.catchTags({
      CommandRefused: ({ refusal }) => refused(409, refusal),
      SchemaError: () => refused(400, { code: 'malformed' }),
      HttpServerError: () => refused(400, { code: 'malformed' }),
    }),
  ),
)
