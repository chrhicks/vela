import type { Review, ReviewReply } from '../../../../state/review.ts'
import type { ReviewCause, ReviewFailureKind, ReviewReason, ReviewStats } from '../../../../state/review-answer.ts'
import type { Reading } from '../../components/Readings.tsx'
import { unknown } from '../../rig/words.ts'

export const causeWords: Record<ReviewCause, string> = {
  obstruction: 'Obstruction',
  cloud: 'Cloud',
  focus: 'Focus',
  'tracking-or-guiding': 'Tracking or guiding',
  'dew-or-frost': 'Dew or frost',
  'bright-sky-or-moon': 'Bright sky or moon',
  'normal-variation': 'Normal variation',
  unknown: 'Unknown',
}

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
  other: 'Failed',
}

export const reasonWords: Record<ReviewReason, string> = {
  hfd: 'HFD up',
  stars: 'Stars down',
  elongation: 'Stars elongated',
  'guide-lost': 'Guide star lost',
  'worse-again': 'Worse again',
}

const percent = (confidence: number) => `${Math.round(confidence * 100)} %`

export function replyLine(reply: ReviewReply | undefined): string {
  if (reply === undefined) return 'Waiting for an answer'

  return reply.outcome._tag === 'Answered' ? reply.outcome.answer.line : failureWords[reply.outcome.failure.kind]
}

export function replyReadings(reply: ReviewReply | undefined): ReadonlyArray<Reading> {
  if (reply === undefined) return []

  if (reply.outcome._tag === 'Failed') return [{ label: 'Failed', value: failureWords[reply.outcome.failure.kind], attention: true }]

  const { cause, confidence } = reply.outcome.answer

  return [
    { label: 'Cause', value: causeWords[cause] },
    { label: 'Confidence', value: percent(confidence) },
  ]
}

export function detailReadings(reply: ReviewReply | undefined): ReadonlyArray<Reading> {
  if (reply === undefined) return []

  const timing: ReadonlyArray<Reading> = [
    { label: 'Took', value: `${reply.seconds.toFixed(1)} s` },
    ...(reply.usage === undefined ? [] : [{ label: 'Tokens', value: `${reply.usage.inputTokens} in · ${reply.usage.outputTokens} out` }]),
  ]

  return [...replyReadings(reply), ...timing]
}

export const replyOf = (review: Review, model: string): ReviewReply | undefined => review.replies.find(reply => reply.model === model)

const fixed = (value: number | null, digits: number, unit = '') => (value === null ? unknown : `${value.toFixed(digits)}${unit}`)

export function statsWords({ hfdPixels, stars, elongation }: ReviewStats): string {
  return `HFD ${fixed(hfdPixels, 2, ' px')} · ${fixed(stars, 0)} stars · elongation ${fixed(elongation, 2)}`
}

export const reasonsWords = (review: Review): string => review.reasons.map(reason => reasonWords[reason]).join(' · ')
