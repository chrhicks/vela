import { Context, Duration, Effect, Layer, Option } from 'effect'
import type { DeviceName } from '../../state/devices.ts'
import type { Value } from '../../state/entry.ts'
import type { Command, Outcome } from '../commands/sender.ts'
import { CommandRefused } from '../feed/commands.ts'

export class DeviceCommands extends Context.Service<
  DeviceCommands,
  {
    readonly write: (device: DeviceName, property: string, values: Readonly<Record<string, Value>>) => Effect.Effect<void, CommandRefused>
  }
>()('vela/DeviceCommands') {}

interface CommandSending {
  readonly send: (command: Command, signal: AbortSignal) => Promise<Outcome>
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

export const deviceCommandsFrom = ({ send, deviceIds, answerSeconds }: CommandSending) =>
  Layer.succeed(DeviceCommands, {
    write: (device, property, values) =>
      Effect.promise(signal => send({ device: deviceIds[device], property, values }, signal)).pipe(
        Effect.timeoutOption(Duration.seconds(answerSeconds)),
        Effect.flatMap(Option.match({ onNone: () => Effect.fail(noAnswer(answerSeconds)), onSome: outcome => answered(outcome, answerSeconds) })),
      ),
  })
