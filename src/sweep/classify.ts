import type { FrameClass } from '../../state/entries.ts'
import type { SweepSettings } from './settings.ts'

export interface SolvedStars {
  readonly altitudeDegrees: number
  readonly stars: number
}

type BaselineSettings = Pick<SweepSettings, 'baselineAltitudeDegrees' | 'baselineTopFraction' | 'baselineMinFrames'>

type ClassSettings = Pick<SweepSettings, 'blockedFraction' | 'skyFraction'>

const median = (values: ReadonlyArray<number>) => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

export function baselineOf(solved: ReadonlyArray<SolvedStars>, altitudeDegrees: number, settings: BaselineSettings): number | undefined {
  if (solved.length === 0) return undefined

  const near = solved.filter(frame => Math.abs(frame.altitudeDegrees - altitudeDegrees) <= settings.baselineAltitudeDegrees)

  if (near.length < settings.baselineMinFrames) return Math.max(...solved.map(frame => frame.stars))

  const best = [...near].sort((a, b) => b.stars - a.stars).slice(0, Math.max(1, Math.ceil(near.length * settings.baselineTopFraction)))

  return median(best.map(frame => frame.stars))
}

export function classify(frame: { readonly solved: boolean; readonly stars: number }, baseline: number | undefined, settings: ClassSettings): FrameClass {
  if (baseline === undefined) return frame.solved ? 'sky' : 'blocked'
  if (frame.stars < settings.blockedFraction * baseline) return 'blocked'
  if (frame.solved && frame.stars >= settings.skyFraction * baseline) return 'sky'

  return 'edge'
}
