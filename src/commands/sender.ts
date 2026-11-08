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
  readonly rigRun: () => string | undefined
  readonly now: () => number
  readonly newId: () => string
  readonly answerTimeoutMs: number
  readonly by: string
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

export function makeSender({ publish, rigRun, now, newId, answerTimeoutMs, by }: SenderOptions) {
  const waiting = new Map<string, (answer: Answer) => void>()

  return {
    answered(entry: Entry) {
      const answer = readAnswer(entry)

      if (answer !== undefined) waiting.get(answer.id)?.(answer)
    },

    async send(command: Command, stop = false): Promise<Outcome> {
      const run = rigRun()

      if (run === undefined && !stop) return { result: 'refused', reason: 'the stream shows no rig connection to send to' }

      const id = newId()
      const answer = new Promise<Answer | undefined>(resolve => {
        const timer = setTimeout(() => resolve(undefined), answerTimeoutMs)

        waiting.set(id, received => {
          clearTimeout(timer)
          resolve(received)
        })
      })

      try {
        publish(commandSubject(command.device), JSON.stringify({ id, run: run ?? '', at: now(), property: command.property, values: command.values, by }))
      } catch (error) {
        waiting.delete(id)

        return { result: 'refused', reason: `could not publish: ${error instanceof Error ? error.message : String(error)}` }
      }

      const received = await answer

      waiting.delete(id)

      if (received === undefined) return { result: 'unknown', reason: `no answer from the rig program within ${answerTimeoutMs / 1000} s` }
      if (received.result === 'refused') return { result: 'refused', reason: received.reason ?? 'no reason given' }

      return { result: 'written' }
    },
  }
}

export type Sender = ReturnType<typeof makeSender>
