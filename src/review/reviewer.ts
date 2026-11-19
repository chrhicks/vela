import Anthropic from '@anthropic-ai/sdk'
import { Context, Data, Effect, Result } from 'effect'
import type { ReviewAnswer, ReviewFailureKind, ReviewUsage } from '../../state/review-answer.ts'
import { decodeAnswer } from './answer.ts'
import { messageParams, type ReviewRequest } from './request.ts'
import type { ReviewSettings } from './settings.ts'

export class ReviewFailed extends Data.TaggedError('ReviewFailed')<{ readonly kind: ReviewFailureKind; readonly message: string }> {}

export interface Reply {
  readonly answer: ReviewAnswer
  readonly usage: ReviewUsage
}

export class Reviewer extends Context.Service<Reviewer, { readonly ask: (model: string, request: ReviewRequest) => Effect.Effect<Reply, ReviewFailed> }>()('vela/Reviewer') {}

export interface Messages {
  readonly create: (params: Anthropic.MessageCreateParamsNonStreaming) => PromiseLike<Anthropic.Message>
}

const noCredit = /credit balance is too low/i
const noCredentialMessage = /could not resolve authentication method/i

export function failureOf(error: unknown): ReviewFailed {
  const message = error instanceof Error ? error.message : String(error)

  if (error instanceof Anthropic.APIConnectionError) return new ReviewFailed({ kind: 'unreachable', message })
  if (error instanceof Anthropic.RateLimitError) return new ReviewFailed({ kind: 'rate-limited', message })
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return new ReviewFailed({ kind: 'rejected', message })
  if (error instanceof Anthropic.APIError) return new ReviewFailed({ kind: error.status === 402 || noCredit.test(message) ? 'no-credit' : 'other', message })
  if (noCredentialMessage.test(message)) return new ReviewFailed({ kind: 'no-credential', message })

  return new ReviewFailed({ kind: 'other', message })
}

function replyOf(response: Anthropic.Message): Result.Result<Reply, ReviewFailed> {
  if (response.stop_reason === 'refusal') return Result.fail(new ReviewFailed({ kind: 'refused', message: 'the model declined to answer' }))
  if (response.stop_reason === 'max_tokens') return Result.fail(new ReviewFailed({ kind: 'truncated', message: 'the answer was cut off by the token limit' }))

  const text = response.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('')

  return decodeAnswer(text).pipe(
    Result.map(answer => ({ answer, usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } })),
    Result.mapError(error => new ReviewFailed({ kind: 'unreadable-answer', message: error.issue })),
  )
}

export function makeReviewer(settings: Pick<ReviewSettings, 'effort' | 'maxTokens'>, messages: Messages): Reviewer['Service'] {
  return {
    ask: (model, request) =>
      Effect.tryPromise({ try: () => Promise.resolve(messages.create(messageParams(settings, model, request))), catch: failureOf }).pipe(Effect.flatMap(response => Effect.fromResult(replyOf(response)))),
  }
}

export function anthropicMessages(): Messages {
  const client = new Anthropic()

  return { create: params => client.messages.create(params) }
}
