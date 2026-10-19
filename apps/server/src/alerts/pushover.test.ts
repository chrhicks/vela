import { describe, expect, it } from 'vitest'
import { NotifierError } from './notifier.js'
import type { Notification } from './notifier.js'
import { createPushoverNotifier } from './pushover.js'

const token = 'fake-token-for-tests'

const user = 'fake-user-for-tests'

const messagesUrl = 'https://api.pushover.net/1/messages.json'

const notification = { title: 'Vela: FRA 400', message: 'Stars collapsed', priority: 2 } satisfies Notification

function fakePushover(responses: ReadonlyMap<string, Response | Error>) {
  const requests: Array<{ url: string; method: string; contentType: string | null; body: string }> = []

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init)

    requests.push({
      url: request.url,
      method: request.method,
      contentType: request.headers.get('content-type'),
      body: await request.text()
    })

    const response = responses.get(request.url)

    if (!response) throw new Error('Unexpected Pushover URL')

    if (response instanceof Error) throw response

    return response
  }

  return { fetch, requests }
}

describe('Pushover notifier', () => {
  it('sends an emergency form with repeat limits and returns the receipt needed to stop repeats', async () => {
    const fake = fakePushover(new Map([
      [messagesUrl, Response.json({ status: 1, request: 'request-1', receipt: 'emergency-1' })]
    ]))

    const notifier = createPushoverNotifier({ token, user, fetch: fake.fetch })

    expect(await notifier.send(notification)).toEqual({ receipt: 'emergency-1' })
    expect(fake.requests).toEqual([{
      url: messagesUrl,
      method: 'POST',
      contentType: 'application/x-www-form-urlencoded',
      body: 'token=fake-token-for-tests&user=fake-user-for-tests&title=Vela%3A+FRA+400&message=Stars+collapsed&priority=2&retry=60&expire=3600'
    }])
  })

  it.each([-1, 0] satisfies Array<-1 | 0>)('sends priority %s without emergency fields or returning a receipt', async priority => {
    const fake = fakePushover(new Map([
      [messagesUrl, Response.json({ status: 1, request: 'request-1', receipt: 'unused-receipt' })]
    ]))

    const notifier = createPushoverNotifier({ token, user, fetch: fake.fetch })

    expect(await notifier.send({ ...notification, priority })).toEqual({ receipt: null })
    expect(fake.requests).toEqual([{
      url: messagesUrl,
      method: 'POST',
      contentType: 'application/x-www-form-urlencoded',
      body: `token=fake-token-for-tests&user=fake-user-for-tests&title=Vela%3A+FRA+400&message=Stars+collapsed&priority=${priority}`
    }])
  })

  it('encodes the whole receipt as one path segment and cancels using only the application token', async () => {
    const cancelUrl = 'https://api.pushover.net/1/receipts/receipt%2Fpart%3Fquery%23fragment/cancel.json'

    const fake = fakePushover(new Map([
      [cancelUrl, Response.json({ status: 1, request: 'cancel-1' })]
    ]))

    const notifier = createPushoverNotifier({ token, user, fetch: fake.fetch })

    await notifier.cancel('receipt/part?query#fragment')

    expect(fake.requests).toEqual([{
      url: cancelUrl,
      method: 'POST',
      contentType: 'application/x-www-form-urlencoded',
      body: 'token=fake-token-for-tests'
    }])
  })

  it('aborts a stuck send and reports the configured timeout instead of hanging delivery', async () => {
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      const signal = init?.signal

      if (!signal) throw new Error('Missing timeout signal')

      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    }

    const notifier = createPushoverNotifier({ token, user, fetch, timeoutMs: 10 })

    await expect(notifier.send(notification)).rejects.toMatchObject({
      name: 'NotifierError',
      reason: 'Pushover timed out after 0.01 s'
    })
  })

  it('discards fetch error details that could leak keys through their message or cause', async () => {
    const fake = fakePushover(new Map([
      [messagesUrl, new TypeError(`failed to fetch ${token}`, { cause: new Error(user) })]
    ]))

    const notifier = createPushoverNotifier({ token, user, fetch: fake.fetch })

    const sending = notifier.send(notification)

    await expect(sending).rejects.toBeInstanceOf(NotifierError)
    await expect(sending).rejects.toMatchObject({ reason: 'could not reach Pushover' })
  })

  it('reports an HTTP failure without exposing a body that is not Pushover\'s explanation', async () => {
    const fake = fakePushover(new Map([
      [messagesUrl, new Response(`${token} ${user}`, { status: 429 })]
    ]))

    const notifier = createPushoverNotifier({ token, user, fetch: fake.fetch })

    await expect(notifier.send(notification)).rejects.toEqual(new NotifierError('Pushover answered HTTP 429'))
  })

  it('gives the reason Pushover sends with a rejected request, such as a wrong token', async () => {
    const fake = fakePushover(new Map([
      [messagesUrl, Response.json({ status: 0, errors: [`application token ${token} is invalid`] }, { status: 400 })]
    ]))

    const notifier = createPushoverNotifier({ token, user, fetch: fake.fetch })

    await expect(notifier.send(notification)).rejects.toEqual(
      new NotifierError('Pushover answered HTTP 400: application token [key] is invalid'),
    )
  })

  it('surfaces all Pushover rejection reasons while redacting every occurrence of either key', async () => {
    const fake = fakePushover(new Map([
      [messagesUrl, Response.json({ status: 0, errors: [`invalid ${token} ${token}`, `unknown ${user}`] })]
    ]))

    const notifier = createPushoverNotifier({ token, user, fetch: fake.fetch })

    await expect(notifier.send(notification)).rejects.toMatchObject({
      name: 'NotifierError',
      reason: 'invalid [key] [key]; unknown [key]'
    })
  })

  it('redacts keys literally even when a fake key contains regular expression characters or overlaps another key', async () => {
    const fake = fakePushover(new Map([
      [messagesUrl, Response.json({ status: 0, errors: ['invalid a.b+long and a.b+'] })]
    ]))

    const notifier = createPushoverNotifier({ token: 'a.b+', user: 'a.b+long', fetch: fake.fetch })

    await expect(notifier.send(notification)).rejects.toMatchObject({
      name: 'NotifierError',
      reason: 'invalid [key] and [key]'
    })
  })

  it.each([
    ['invalid JSON', '{'],
    ['a missing status', '{"request":"request-1"}'],
    ['a string status', '{"status":"1","request":"request-1"}'],
    ['a missing request identifier', '{"status":1}'],
    ['a non-string receipt', '{"status":1,"request":"request-1","receipt":7}']
  ])('rejects %s instead of treating an unreadable answer as successful delivery', async (_description, body) => {
    const fake = fakePushover(new Map([[messagesUrl, new Response(body)]]))
    const notifier = createPushoverNotifier({ token, user, fetch: fake.fetch })

    await expect(notifier.send(notification)).rejects.toEqual(new NotifierError('Pushover sent an unreadable answer'))
  })

  it('rejects an emergency success without a receipt because repeats could not be cancelled', async () => {
    const fake = fakePushover(new Map([
      [messagesUrl, Response.json({ status: 1, request: 'request-1' })]
    ]))

    const notifier = createPushoverNotifier({ token, user, fetch: fake.fetch })

    await expect(notifier.send(notification)).rejects.toEqual(new NotifierError('Pushover did not return an emergency receipt'))
  })

  it('reports a rejected cancellation instead of pretending emergency repeats stopped', async () => {
    const cancelUrl = 'https://api.pushover.net/1/receipts/emergency-1/cancel.json'

    const fake = fakePushover(new Map([
      [cancelUrl, Response.json({ status: 0, errors: ['receipt not found'] })]
    ]))

    const notifier = createPushoverNotifier({ token, user, fetch: fake.fetch })

    await expect(notifier.cancel('emergency-1')).rejects.toEqual(new NotifierError('receipt not found'))
  })
})
