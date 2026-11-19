import type { Review, ReviewReply } from '../../../../state/review.ts'
import type { ReviewFailureKind } from '../../../../state/review-answer.ts'
import type { Reading } from '../../components/Readings.tsx'

export const failureWords: Record<ReviewFailureKind, string> = {
  'no-credential': 'No sign-in. Run ant auth login.',
  rejected: 'The sign-in was refused',
  'no-credit': 'Out of credit',
  'rate-limited': 'Rate limited',
  unreachable: 'Could not reach the service',
  refused: 'The model declined to answer',
  truncated: 'The answer was cut off',
  'unreadable-answer': 'The answer could not be read',
  'no-picture': 'No picture to send',
  restarted: 'Vela restarted before the answer came',
  other: 'Failed',
}

export type Verdict = 'clear' | 'obstructed' | 'failed' | 'waiting'

export const verdictOf = (reply: ReviewReply | undefined): Verdict => {
  if (reply === undefined) return 'waiting'
  if (reply.outcome._tag === 'Failed') return 'failed'

  return reply.outcome.answer.obstructed ? 'obstructed' : 'clear'
}

export const verdictWords: Record<Verdict, string> = { clear: 'Clear', obstructed: 'Obstructed', failed: 'Failed', waiting: 'Waiting for an answer' }

export const replyOf = (review: Review, model: string): ReviewReply | undefined => review.replies.find(reply => reply.model === model)

const percent = (confidence: number) => `${Math.round(confidence * 100)} %`

export function replyReadings(reply: ReviewReply | undefined): ReadonlyArray<Reading> {
  if (reply === undefined) return []

  if (reply.outcome._tag === 'Failed') return [{ label: 'Failed', value: failureWords[reply.outcome.failure.kind], attention: true }]

  const { obstructed, confidence, hazard } = reply.outcome.answer

  return [
    { label: 'Verdict', value: verdictWords[obstructed ? 'obstructed' : 'clear'], attention: obstructed },
    { label: 'Confidence', value: percent(confidence) },
    { label: 'Hazard', value: hazard },
  ]
}

export function detailReadings(reply: ReviewReply | undefined): ReadonlyArray<Reading> {
  if (reply === undefined) return []

  return [...replyReadings(reply), { label: 'Took', value: `${reply.seconds.toFixed(1)} s` }, ...(reply.usage === undefined ? [] : [{ label: 'Tokens', value: `${reply.usage.inputTokens} in · ${reply.usage.outputTokens} out` }])]
}

export const sentenceOf = (reply: ReviewReply | undefined): string | undefined => (reply?.outcome._tag === 'Answered' ? reply.outcome.answer.what : undefined)

export function summaryOf(reply: ReviewReply | undefined): string {
  if (reply === undefined || reply.outcome._tag === 'Failed') return verdictWords[verdictOf(reply)]

  const { obstructed, confidence, hazard } = reply.outcome.answer

  return `${verdictWords[obstructed ? 'obstructed' : 'clear']} ${percent(confidence)}, ${hazard}`
}
