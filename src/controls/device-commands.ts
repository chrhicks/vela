import { Context, Duration, Effect, Layer, Option } from 'effect'
import type { DeviceName } from '../../state/devices.ts'
import { guiderDevice } from '../../state/entries.ts'
import type { Value } from '../../state/entry.ts'
import type { Command, Outcome, Request } from '../commands/sender.ts'
import { CommandRefused } from '../feed/commands.ts'

export class DeviceCommands extends Context.Service<
  DeviceCommands,
  {
    readonly write: (device: DeviceName, property: string, values: Readonly<Record<string, Value>>) => Effect.Effect<void, CommandRefused>
    readonly ask: (device: DeviceName, label: string, id: string, body: Readonly<Record<string, unknown>>) => Effect.Effect<void, CommandRefused>
    readonly tell: (device: DeviceName, body: Readonly<Record<string, unknown>>) => Effect.Effect<void>
    readonly askGuider: (id: string, method: string, params: unknown) => Effect.Effect<void, CommandRefused>
  }
>()('vela/DeviceCommands') {}

interface CommandSending {
  readonly send: (command: Command, signal: AbortSignal) => Promise<Outcome>
  readonly ask: (request: Request, signal: AbortSignal) => Promise<Outcome>
  readonly tell: (device: string, body: Readonly<Record<string, unknown>>) => void
  readonly deviceIds: Readonly<Record<DeviceName, string>>
  readonly answerSeconds: number
}

const noAnswer = (seconds: number) => new CommandRefused({ refusal: { code: 'no-answer', seconds } })

const answered = (outcome: Outcome, seconds: number): Effect.Effect<void, CommandRefused> => {
  switch (outcome.result) {
    case 'written':
      return Effect.void
    case 'refused':
      return Effect.fail(new CommandRefused({ refusal: { code: 'rig-refused', text: outcome.reason } }))
    case 'unknown':
      return Effect.fail(noAnswer(seconds))
  }
}

export const deviceCommandsFrom = ({ send, ask, tell, deviceIds, answerSeconds }: CommandSending) => {
  const awaited = (sending: (signal: AbortSignal) => Promise<Outcome>) =>
    Effect.promise(sending).pipe(
      Effect.timeoutOption(Duration.seconds(answerSeconds)),
      Effect.flatMap(Option.match({ onNone: () => Effect.fail(noAnswer(answerSeconds)), onSome: outcome => answered(outcome, answerSeconds) })),
    )

  return Layer.succeed(DeviceCommands, {
    write: (device, property, values) => awaited(signal => send({ device: deviceIds[device], property, values }, signal)),
    ask: (device, label, id, body) => awaited(signal => ask({ device: deviceIds[device], label, id, body }, signal)),
    tell: (device, body) => Effect.sync(() => tell(deviceIds[device], body)).pipe(Effect.ignore),
    askGuider: (id, method, params) => awaited(signal => ask({ device: guiderDevice, label: method, id, body: { method, ...(params === undefined ? {} : { params }) } }, signal)),
  })
}
