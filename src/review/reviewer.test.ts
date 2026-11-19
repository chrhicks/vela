import Anthropic from '@anthropic-ai/sdk'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import type { ReviewRequest } from './request.ts'
import { failureOf, makeReviewer, type Messages } from './reviewer.ts'

const request: ReviewRequest = {
  good: new Uint8Array([1]),
  current: new Uint8Array([2]),
  facts: {
    target: 'IC 1396',
    exposureSeconds: 180,
    reasons: ['hfd'],
    baseline: { hfdPixels: 2.4, stars: 2900 },
    lastGood: { minutes: 90, hfdPixels: 2.4, stars: 2900, elongation: 1.1, sky: 1200, noise: 30, altitudeDegrees: 48, azimuthDegrees: 61 },
    current: { minutes: 100, hfdPixels: 3.3, stars: 1900, elongation: 1.1, sky: 1200, noise: 30, altitudeDegrees: 45, azimuthDegrees: 64 },
    trend: [],
    events: [],
  },
}

const settings = { effort: 'high', maxTokens: 16000 } as Parameters<typeof makeReviewer>[0]

const good = { sees: 'Stars are cut off along one edge.', cause: 'obstruction', confidence: 0.8, fix: 'Pick a target that clears the roofline.', line: 'Target behind an obstruction' }

const message = (overrides: Partial<Anthropic.Message>): Anthropic.Message =>
  ({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [{ type: 'text', text: JSON.stringify(good) }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 3100, output_tokens: 420 },
    ...overrides,
  }) as Anthropic.Message

const answering = (response: Anthropic.Message | Error): { readonly messages: Messages; readonly sent: Array<Anthropic.MessageCreateParamsNonStreaming> } => {
  const sent: Array<Anthropic.MessageCreateParamsNonStreaming> = []

  return {
    sent,
    messages: {
      create: params => {
        sent.push(params)

        return response instanceof Error ? Promise.reject(response) : Promise.resolve(response)
      },
    },
  }
}

const asked = (response: Anthropic.Message | Error) => {
  const fake = answering(response)

  return Effect.runPromise(Effect.result(makeReviewer(settings, fake.messages).ask('claude-opus-5-5', request))).then(result => ({ result, sent: fake.sent }))
}

const apiError = (status: number, message: string) => Anthropic.APIError.generate(status, { type: 'error', error: { type: 'invalid_request_error', message } }, message, new Headers())

describe('asking a model', () => {
  it('decodes the structured answer and the token usage', async () => {
    const { result, sent } = await asked(message({}))

    expect(result).toMatchObject({ _tag: 'Success', success: { answer: good, usage: { inputTokens: 3100, outputTokens: 420 } } })
    expect(sent[0]?.model).toBe('claude-opus-5-5')
  })

  it('reads the answer from the text after thinking blocks', async () => {
    const { result } = await asked(message({ content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: JSON.stringify(good) }] as Anthropic.Message['content'] }))

    expect(result).toMatchObject({ _tag: 'Success' })
  })

  it('fails with a typed error when the answer is not JSON, names a cause outside the set or has a confidence outside 0 to 1', async () => {
    for (const text of ['I think it is a tree', JSON.stringify({ ...good, cause: 'aliens' }), JSON.stringify({ ...good, confidence: 1.4 }), JSON.stringify({ sees: 'x' })]) {
      const { result } = await asked(message({ content: [{ type: 'text', text }] as Anthropic.Message['content'] }))

      expect(result).toMatchObject({ _tag: 'Failure', failure: { _tag: 'ReviewFailed', kind: 'unreadable-answer' } })
    }
  })

  it('fails with a typed error when the model refuses or runs out of tokens', async () => {
    expect((await asked(message({ stop_reason: 'refusal' }))).result).toMatchObject({ failure: { kind: 'refused' } })
    expect((await asked(message({ stop_reason: 'max_tokens' }))).result).toMatchObject({ failure: { kind: 'truncated' } })
  })

  it('names why a call failed: no sign-in, a rejected one, no credit, a rate limit, no connection', () => {
    expect(failureOf(new Error('Could not resolve authentication method. Expected one of apiKey, authToken, credentials, config, or profile to be set.')).kind).toBe('no-credential')
    expect(failureOf(apiError(401, 'invalid x-api-key')).kind).toBe('rejected')
    expect(failureOf(apiError(403, 'not allowed')).kind).toBe('rejected')
    expect(failureOf(apiError(400, 'Your credit balance is too low to access the Anthropic API.')).kind).toBe('no-credit')
    expect(failureOf(apiError(402, 'billing')).kind).toBe('no-credit')
    expect(failureOf(apiError(429, 'slow down')).kind).toBe('rate-limited')
    expect(failureOf(new Anthropic.APIConnectionError({ message: 'Connection error.' })).kind).toBe('unreachable')
    expect(failureOf(apiError(500, 'overloaded')).kind).toBe('other')
    expect(failureOf(new Error('boom')).kind).toBe('other')
  })

  it('carries the SDK\'s message on the failure and turns a failed call into a typed error', async () => {
    const { result } = await asked(new Anthropic.AnthropicError('Could not resolve authentication method.'))

    expect(result).toMatchObject({ _tag: 'Failure', failure: { kind: 'no-credential', message: 'Could not resolve authentication method.' } })
  })
})
