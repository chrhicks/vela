import { recordOf, type Entry, type Value } from '../stream/entry.ts'

export const commandSubject = (device: string) => `rig-dev.command.${device}`

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

interface Answer {
  readonly id: string
  readonly result: 'written' | 'refused'
  readonly reason: string | undefined
}

export function readAnswer(entry: Entry): Answer | undefined {
  if (entry.kind !== answerKind) return undefined

  const body = recordOf(entry.body)
  const result = body?.['result']

  if (body === undefined || typeof body['id'] !== 'string' || (result !== 'written' && result !== 'refused')) return undefined

  return { id: body['id'], result, reason: typeof body['reason'] === 'string' ? body['reason'] : undefined }
}

export function makeSender({ publish, newId, answerTimeoutMs, by, now }: SenderOptions) {
  const waiting = new Map<string, { readonly command: Command; readonly sentAt: number; readonly resolve: (answer: Answer) => void }>()

  return {
    answered(entry: Entry) {
      const answer = readAnswer(entry)

      if (answer !== undefined) waiting.get(answer.id)?.resolve(answer)
    },

    late(at: number): ReadonlyArray<LateCommand> {
      return [...waiting.values()].filter(sent => at - sent.sentAt >= answerTimeoutMs).map(sent => ({ device: sent.command.device, property: sent.command.property, seconds: Math.round((at - sent.sentAt) / 1000) }))
    },

    async send(command: Command, signal?: AbortSignal): Promise<Outcome> {
      if (signal?.aborted) return { result: 'unknown', reason: 'Stop pressed before it was sent' }

      const id = newId()
      const answer = new Promise<Answer | undefined>(resolve => {
        const stopped = () => resolve(undefined)

        signal?.addEventListener('abort', stopped, { once: true })
        waiting.set(id, {
          command,
          sentAt: now(),
          resolve: received => {
            signal?.removeEventListener('abort', stopped)
            resolve(received)
          },
        })
      })

      try {
        publish(commandSubject(command.device), JSON.stringify({ id, property: command.property, values: command.values, by }))
      } catch (error) {
        waiting.delete(id)

        return { result: 'refused', reason: `could not publish: ${error instanceof Error ? error.message : String(error)}` }
      }

      const received = await answer

      waiting.delete(id)

      if (received === undefined) return { result: 'unknown', reason: 'Stop pressed before the rig program answered' }
      if (received.result === 'refused') return { result: 'refused', reason: received.reason ?? 'no reason given' }

      return { result: 'written' }
    },
  }
}

export type Sender = ReturnType<typeof makeSender>
