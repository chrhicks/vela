import { Effect, Schema } from 'effect'
import { commandsPath, Done, NudgeId, Refusal, type CommandRequest } from '../../../state/commands.ts'

export type Answer = { readonly result: 'done'; readonly done: Done } | { readonly result: 'refused'; readonly refusal: Refusal }

const decodeDone = Schema.decodeUnknownEffect(Done)

const decodeRefusal = Schema.decodeUnknownEffect(Refusal)

const unreachable: Answer = { result: 'refused', refusal: { code: 'unreachable' } }

const answerOf = (response: Response) =>
  Effect.tryPromise(() => response.json()).pipe(
    Effect.flatMap(body =>
      response.ok ? Effect.map(decodeDone(body), (done): Answer => ({ result: 'done', done })) : Effect.map(decodeRefusal(body), (refusal): Answer => ({ result: 'refused', refusal })),
    ),
  )

const send = (request: CommandRequest): Effect.Effect<Answer> =>
  Effect.tryPromise(() => fetch(commandsPath, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) })).pipe(
    Effect.flatMap(answerOf),
    Effect.catchTags({ UnknownError: () => Effect.succeed(unreachable), SchemaError: () => Effect.succeed(unreachable) }),
  )

export const sendCommand = (request: CommandRequest): Promise<Answer> => Effect.runPromise(send(request))

export const newNudgeId = (): NudgeId => NudgeId.make(crypto.randomUUID())
