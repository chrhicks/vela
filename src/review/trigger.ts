import type { ReviewReason } from '../../state/review-answer.ts'

export interface TriggerLimits {
  readonly baselineFrames: number
  readonly hfdRise: number
  readonly starsDrop: number
  readonly elongation: number
  readonly guideLostBurst: number
  readonly cooldownFrames: number
  readonly worseAgain: number
}

export interface Sample {
  readonly file: string
  readonly hfdPixels: number | null
  readonly stars: number | null
  readonly elongation: number | null
  readonly guideLost: number
}

export interface Baseline {
  readonly hfdPixels: number
  readonly stars: number
}

interface LastAsk {
  readonly frames: number
  readonly hfdPixels: number | null
  readonly stars: number | null
}

export interface Trigger {
  readonly frames: number
  readonly early: ReadonlyArray<Sample>
  readonly baseline: Baseline | undefined
  readonly lastGood: Sample | undefined
  readonly lastAsk: LastAsk | undefined
}

export interface Ask {
  readonly reasons: ReadonlyArray<ReviewReason>
  readonly baseline: Baseline
  readonly good: Sample
}

export const newTrigger: Trigger = { frames: 0, early: [], baseline: undefined, lastGood: undefined, lastAsk: undefined }

const median = (values: ReadonlyArray<number>) => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1

  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

const measured = (sample: Sample) => sample.hfdPixels !== null && sample.stars !== null && sample.stars > 0

function reasonsOf(limits: TriggerLimits, baseline: Baseline, sample: Sample): ReadonlyArray<ReviewReason> {
  const reasons: ReviewReason[] = []

  if (sample.hfdPixels !== null && sample.hfdPixels >= baseline.hfdPixels * (1 + limits.hfdRise)) reasons.push('hfd')
  if (sample.stars !== null && sample.stars <= baseline.stars * (1 - limits.starsDrop)) reasons.push('stars')
  if (sample.elongation !== null && sample.elongation > limits.elongation) reasons.push('elongation')
  if (sample.guideLost >= limits.guideLostBurst) reasons.push('guide-lost')

  return reasons
}

const worseThanAsked = (limits: TriggerLimits, last: LastAsk, sample: Sample) =>
  (sample.hfdPixels !== null && last.hfdPixels !== null && sample.hfdPixels >= last.hfdPixels * (1 + limits.worseAgain)) ||
  (sample.stars !== null && last.stars !== null && sample.stars <= last.stars * (1 - limits.worseAgain))

function establishing(limits: TriggerLimits, state: Trigger, sample: Sample): Trigger {
  const frames = state.frames + 1
  const good = measured(sample) && (sample.elongation === null || sample.elongation <= limits.elongation)

  if (!good) return { ...state, frames }

  const early = [...state.early, sample]

  if (early.length < limits.baselineFrames) return { ...state, frames, early, lastGood: sample }

  return { ...state, frames, early, lastGood: sample, baseline: { hfdPixels: median(early.map(each => each.hfdPixels!)), stars: median(early.map(each => each.stars!)) } }
}

export function observe(limits: TriggerLimits, state: Trigger, sample: Sample): { readonly state: Trigger; readonly ask: Ask | undefined } {
  const { baseline } = state

  if (baseline === undefined) return { state: establishing(limits, state, sample), ask: undefined }

  const frames = state.frames + 1
  const reasons = reasonsOf(limits, baseline, sample)

  if (reasons.length === 0) return { state: { ...state, frames, lastGood: sample }, ask: undefined }

  const { lastAsk, lastGood } = state
  const cooledDown = lastAsk === undefined || frames - lastAsk.frames >= limits.cooldownFrames
  const worse = lastAsk !== undefined && !cooledDown && worseThanAsked(limits, lastAsk, sample)

  if (lastGood === undefined || !(cooledDown || worse)) return { state: { ...state, frames }, ask: undefined }

  return {
    state: { ...state, frames, lastAsk: { frames, hfdPixels: sample.hfdPixels, stars: sample.stars } },
    ask: { reasons: worse ? [...reasons, 'worse-again'] : reasons, baseline, good: lastGood },
  }
}
