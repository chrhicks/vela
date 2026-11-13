import { Context, Data, Effect, Match } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http'
import { commandsPath, CommandRequest, type FilterAnswer, type Refusal } from '../../state/commands.ts'

export class CommandRefused extends Data.TaggedError('CommandRefused')<{ readonly text: string }> {}

export class Operations extends Context.Service<
  Operations,
  {
    readonly startAlignment: Effect.Effect<void, CommandRefused>
    readonly finishAlignment: Effect.Effect<void, CommandRefused>
    readonly answerFilter: (filter: FilterAnswer) => Effect.Effect<void, CommandRefused>
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
      CommandRefused: ({ text }) => refused(409, { code: 'refused', text }),
      SchemaError: () => refused(400, { code: 'malformed' }),
      HttpServerError: () => refused(400, { code: 'malformed' }),
    }),
  ),
)
