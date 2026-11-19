import type Anthropic from '@anthropic-ai/sdk'
import type { ReviewReason } from '../../state/review-answer.ts'
import { answerFormat } from './answer.ts'
import type { ReviewSettings } from './settings.ts'

export interface TrendRow {
  readonly minutes: number
  readonly hfdPixels: number | null
  readonly stars: number | null
  readonly elongation: number | null
  readonly sky: number
  readonly noise: number
  readonly altitudeDegrees: number | null
  readonly azimuthDegrees: number | null
}

export interface ReviewEvent {
  readonly minutes: number
  readonly event: 'StarLost' | 'SettleFailed'
}

export interface ReviewFacts {
  readonly target: string
  readonly exposureSeconds: number
  readonly filter?: string
  readonly reasons: ReadonlyArray<ReviewReason>
  readonly baseline: { readonly hfdPixels: number; readonly stars: number }
  readonly lastGood: TrendRow
  readonly current: TrendRow
  readonly trend: ReadonlyArray<TrendRow>
  readonly events: ReadonlyArray<ReviewEvent>
}

export interface ReviewRequest {
  readonly good: Uint8Array
  readonly current: Uint8Array
  readonly facts: ReviewFacts
}

const system = [
  'You are looking at frames from an amateur astrophotography rig: long exposures of one deep-sky target, taken with a one-shot-colour camera on a tracking mount guided by PHD2.',
  'A run of light frames was going well and the measurements of the newest frame have changed for the worse.',
  'You get two auto-stretched previews, the last frame that was still fine and the new one, and the measurements as JSON.',
  'hfdPixels is the half-flux diameter of the stars in camera pixels of the full-size frame (the previews are smaller). elongation is the stars\' long side over short side, 1 being round. sky is the median pixel level and noise its spread, both in ADU.',
  'trend lists the latest frames, with minutes counted from the start of the run. altitudeDegrees and azimuthDegrees are where the telescope points, azimuth clockwise from north. events lists PHD2 star-lost and settle-failure events, with the same minutes.',
  'Say what you see in the two pictures and what most likely explains the change.',
  'Things to weigh: something close to the telescope in the light path (power lines, branches, a roof edge) is far out of focus, so it shows as broad, soft-edged bands or patches, straight and parallel for wires, bright when lit from below and dark otherwise, that stay at one angle and drift steadily as the telescope tracks, and it comes back whenever the telescope points that way; thin cloud or haze loses stars and brightens the sky; focus drift bloats stars evenly without losing them first; tracking or guiding trouble elongates stars in one direction and comes with star-lost events; dew or frost bloats stars with halos and loses faint ones; a bright sky or the Moon raises the sky level and noise.',
  'Answer unknown when the pictures and numbers do not decide, and normal-variation when the change is within what the run has varied by. Do not guess where the rig is.',
].join('\n\n')

const text = (value: string): Anthropic.TextBlockParam => ({ type: 'text', text: value })

const image = (png: Uint8Array): Anthropic.ImageBlockParam => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from(png).toString('base64') } })

export function messageParams(settings: Pick<ReviewSettings, 'effort' | 'maxTokens'>, model: string, request: ReviewRequest): Anthropic.MessageCreateParamsNonStreaming {
  const { facts } = request

  return {
    model,
    max_tokens: settings.maxTokens,
    thinking: { type: 'adaptive' },
    output_config: { effort: settings.effort, format: answerFormat },
    system,
    messages: [
      {
        role: 'user',
        content: [
          text(`The last good frame, ${facts.lastGood.minutes} minutes into the run:`),
          image(request.good),
          text(`The new frame, ${facts.current.minutes} minutes into the run:`),
          image(request.current),
          text(`Measurements:\n${JSON.stringify(facts)}`),
        ],
      },
    ],
  }
}
