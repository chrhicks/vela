import { Option, Schema } from 'effect'
import type { Entry, Value } from '../../state/entry.ts'

export const answerKind = 'client.command'

export type Outcome =
  | { readonly result: 'written' }
  | { readonly result: 'refused'; readonly reason: string }
  | { readonly result: 'unknown'; readonly reason: string }

export interface Command {
  readonly device: string
  readonly property: string
  readonly values: Readonly<Record<string, Value>>
}

export interface SenderOptions {
  readonly subjectOf: (device: string) => string
  readonly publish: (subject: string, payload: string) => void
  readonly newId: () => string
  readonly answerTimeoutMs: number
  readonly by: string
  readonly now: () => number
}

export interface LateCommand {
  readonly device: string
  readonly property: string
  readonly seconds: number
}

const Answer = Schema.Struct({ id: Schema.String, result: Schema.Literals(['written', 'refused']), reason: Schema.optionalKey(Schema.String) })

type Answer = typeof Answer.Type

const decodeAnswer = Schema.decodeUnknownOption(Answer)

export const readAnswer = (entry: Entry): Answer | undefined => (entry.kind === answerKind ? Option.getOrUndefined(decodeAnswer(entry.body)) : undefined)

export interface Request {
  readonly device: string
  readonly label: string
  readonly id: string
  readonly body: Readonly<Record<string, unknown>>
}

export function makeSender({ subjectOf, publish, newId, answerTimeoutMs, by, now }: SenderOptions) {
  const waiting = new Map<string, { readonly device: string; readonly label: string; readonly sentAt: number; readonly resolve: (answer: Answer) => void }>()

  async function ask({ device, label, id, body }: Request, signal?: AbortSignal): Promise<Outcome> {
    if (signal?.aborted) return { result: 'unknown', reason: 'Stop pressed before it was sent' }

    const answer = new Promise<Answer | undefined>(resolve => {
      const stopped = () => resolve(undefined)

      signal?.addEventListener('abort', stopped, { once: true })
      waiting.set(id, {
        device,
        label,
        sentAt: now(),
        resolve: received => {
          signal?.removeEventListener('abort', stopped)
          resolve(received)
        },
      })
    })

    try {
      publish(subjectOf(device), JSON.stringify({ ...body, id, by }))
    } catch (error) {
      waiting.delete(id)

      return { result: 'refused', reason: `could not publish: ${error instanceof Error ? error.message : String(error)}` }
    }

    const received = await answer

    waiting.delete(id)

    if (received === undefined) return { result: 'unknown', reason: 'Stop pressed before the rig program answered' }
    if (received.result === 'refused') return { result: 'refused', reason: received.reason ?? 'no reason given' }

    return { result: 'written' }
  }

  return {
    answered(entry: Entry) {
      const answer = readAnswer(entry)

      if (answer !== undefined) waiting.get(answer.id)?.resolve(answer)
    },

    late(at: number): ReadonlyArray<LateCommand> {
      return [...waiting.values()].filter(sent => at - sent.sentAt >= answerTimeoutMs).map(sent => ({ device: sent.device, property: sent.label, seconds: Math.round((at - sent.sentAt) / 1000) }))
    },

    send: (command: Command, signal?: AbortSignal): Promise<Outcome> => ask({ device: command.device, label: command.property, id: newId(), body: { property: command.property, values: command.values } }, signal),

    ask,

    tell(device: string, body: Readonly<Record<string, unknown>>): void {
      publish(subjectOf(device), JSON.stringify({ ...body, id: newId(), by }))
    },
  }
}

export type Sender = ReturnType<typeof makeSender>
