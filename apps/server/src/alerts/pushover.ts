import { z } from 'zod'
import { emergencyExpireSeconds, emergencyRetrySeconds, NotifierError } from './notifier.js'
import type { Notifier } from './notifier.js'

interface PushoverOptions {
  token: string
  user: string
  fetch: typeof globalThis.fetch
  timeoutMs?: number
}

const responseSchema = z.object({
  status: z.number(),
  request: z.string().optional(),
  errors: z.array(z.string()).optional(),
  receipt: z.string().min(1).optional()
})

export function createPushoverNotifier({ token, user, fetch, timeoutMs = 10_000 }: PushoverOptions): Notifier {
  const keys = [token, user]
    .filter(key => key.length > 0)
    .sort((left, right) => right.length - left.length)
    .map(key => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

  const keyPattern = keys.length > 0 ? new RegExp(keys.join('|'), 'g') : null

  function failure(reason: string) {
    return new NotifierError(keyPattern ? reason.replace(keyPattern, '[key]') : reason)
  }

  /** Pushover explains a rejected request in its body, such as an invalid token. */
  async function rejectionDetail(response: Response) {
    const answer = responseSchema.safeParse(await response.json().catch(() => null))
    const errors = answer.success ? answer.data.errors : undefined

    return errors?.length ? `: ${errors.join('; ')}` : ''
  }

  async function post(path: string, body: URLSearchParams) {
    const signal = AbortSignal.timeout(timeoutMs)
    const timeoutReason = `Pushover timed out after ${timeoutMs / 1000} s`
    let response: Response

    try {
      response = await fetch(`https://api.pushover.net/1/${path}.json`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal
      })
    } catch {
      throw failure(signal.aborted ? timeoutReason : 'could not reach Pushover')
    }

    if (!response.ok) throw failure(`Pushover answered HTTP ${response.status}${await rejectionDetail(response)}`)

    let answer: unknown

    try {
      answer = await response.json()
    } catch {
      throw failure(signal.aborted ? timeoutReason : 'Pushover sent an unreadable answer')
    }

    const parsed = responseSchema.safeParse(answer)

    if (!parsed.success) throw failure('Pushover sent an unreadable answer')

    if (parsed.data.status !== 1)
      throw failure(parsed.data.errors?.join('; ') || 'Pushover rejected the request')

    if (!parsed.data.request) throw failure('Pushover sent an unreadable answer')

    return parsed.data
  }

  return {
    async send(notification) {
      const body = new URLSearchParams({
        token,
        user,
        title: notification.title,
        message: notification.message,
        priority: String(notification.priority)
      })

      if (notification.priority === 2) {
        body.set('retry', String(emergencyRetrySeconds))
        body.set('expire', String(emergencyExpireSeconds))
      }

      const answer = await post('messages', body)

      if (notification.priority !== 2) return { receipt: null }

      if (!answer.receipt) throw failure('Pushover did not return an emergency receipt')

      return { receipt: answer.receipt }
    },
    async cancel(receipt) {
      await post(`receipts/${encodeURIComponent(receipt)}/cancel`, new URLSearchParams({ token }))
    }
  }
}
