import { Effect, Schema } from 'effect'
import { commandsPath, NudgeId, Refusal, type CommandRequest } from '../../../state/commands.ts'

const decodeRefusal = Schema.decodeUnknownEffect(Refusal)

const unreachable: Refusal = { code: 'unreachable' }

const send = (request: CommandRequest): Effect.Effect<Refusal | undefined> =>
  Effect.tryPromise(() => fetch(commandsPath, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) })).pipe(
    Effect.flatMap(response => (response.ok ? Effect.succeed(undefined) : Effect.tryPromise(() => response.json()).pipe(Effect.flatMap(decodeRefusal)))),
    Effect.catchTags({ UnknownError: () => Effect.succeed(unreachable), SchemaError: () => Effect.succeed(unreachable) }),
  )

export const sendCommand = (request: CommandRequest): Promise<Refusal | undefined> => Effect.runPromise(send(request))

export const newNudgeId = (): NudgeId => NudgeId.make(crypto.randomUUID())
