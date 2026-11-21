import type Anthropic from '@anthropic-ai/sdk'
import type { ReviewLine } from '../../state/review-answer.ts'
import { answerFormat } from './answer.ts'
import { horizonSentence } from './line.ts'
import type { ReviewSettings } from './settings.ts'

export interface ReviewRequest {
  readonly picture: Uint8Array
  readonly exposureSeconds: number
  readonly line?: ReviewLine
}

export const questionOf = (exposureSeconds: number, hazards: ReadonlyArray<string>, line?: ReviewLine) => {
  const question = `Here is an image of a ${exposureSeconds} s astrophotography exposure. Please say, with a confidence float from 0 to 1, whether it is obstructed. Known hazards to appear during an observation session: ${hazards.join(', ')}.`

  return line === undefined ? question : `${question} ${horizonSentence(line)}`
}

export function messageParams(settings: Pick<ReviewSettings, 'effort' | 'maxTokens' | 'hazards'>, model: string, request: ReviewRequest): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: settings.maxTokens,
    thinking: { type: 'adaptive' },
    output_config: { effort: settings.effort, format: answerFormat(settings.hazards) },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from(request.picture).toString('base64') } },
          { type: 'text', text: questionOf(request.exposureSeconds, settings.hazards, request.line) },
        ],
      },
    ],
  }
}
