import { median } from './median.js'
import type { AlertThresholds } from './thresholds.js'

/** What one frame's measurement says about why its stars changed. */
export interface FrameEvidence {
  /** Peaks found above the sky, before any gate. */
  peaks: number
  /** Peaks left out because a neighbour overlapped them. */
  blended: number
  /** Median sky level of the frame, in raw sample units. */
  sky: number
  /** Median axis ratio of the strong stars, 1 for round. Null from too few stars to say. */
  axisRatio: number | null
}

/** What the frames no alert called bad looked like. */
export interface NormalEvidence {
  peaks: number
  sky: number
  blendedShare: number
}

/** The last few frames, summarised the way the causes read them. */
interface Recent {
  peaks: number
  brightestSky: number
  blendedShare: number
  axisRatios: number[]
}

interface Cause {
  label: string
  holds(recent: Recent, normal: NormalEvidence | null, t: AlertThresholds): boolean
}

/**
 * In order of how plainly each explains a fall in stars; the first that holds is named. Each reads
 * only what the frames measured. A cause that compares with a normal is not named until the history
 * has one, and the trailing cause needs the strong stars of at least two frames, all of them
 * elongated.
 */
const causes: Cause[] = [
  {
    label: 'sky brightened',
    holds: (recent, normal, t) => normal !== null && normal.sky > 0 && recent.brightestSky >= t.causeSkyRatio * normal.sky,
  },
  {
    label: 'stars trailed',
    holds: (recent, _, t) => recent.axisRatios.length >= 2 && Math.min(...recent.axisRatios) >= t.causeTrailedAxisRatio,
  },
  {
    label: 'stars smeared or soft',
    holds: (recent, normal, t) => normal !== null && recent.blendedShare >= normal.blendedShare + t.causeBlendedShareRise,
  },
  {
    label: 'few peaks',
    holds: (recent, normal, t) => normal !== null && normal.peaks > 0 && recent.peaks < t.causePeaksRatio * normal.peaks,
  },
]

/** The median of the last accepted frames, or null until there are enough to trust. */
export function normalEvidence(accepted: FrameEvidence[], t: AlertThresholds): NormalEvidence | null {
  if (accepted.length < t.minBaselineFrames) return null

  const last = accepted.slice(-t.baselineFrames)

  return {
    peaks: median(last.map(evidence => evidence.peaks)),
    sky: median(last.map(evidence => evidence.sky)),
    blendedShare: median(last.map(blendedShare)),
  }
}

export const behindTheTrees = 'behind the trees'

/**
 * Why the stars fell, from the last `starsSmoothingFrames` frames against the normal, or null when the
 * evidence is not clear. A majority of those frames must carry evidence. A mount pointed at or below the
 * rig's horizon comes first and needs none: the position explains everything the frames could say.
 */
export function starCause(
  recent: FrameEvidence[],
  normal: NormalEvidence | null,
  t: AlertThresholds,
  pointedBehindHorizon = false,
) {
  if (pointedBehindHorizon) return behindTheTrees

  if (recent.length * 2 <= t.starsSmoothingFrames) return null

  const summary: Recent = {
    peaks: median(recent.map(evidence => evidence.peaks)),
    brightestSky: Math.max(...recent.map(evidence => evidence.sky)),
    blendedShare: median(recent.map(blendedShare)),
    axisRatios: recent.flatMap(evidence => (evidence.axisRatio === null ? [] : [evidence.axisRatio])),
  }

  return causes.find(cause => cause.holds(summary, normal, t))?.label ?? null
}

function blendedShare(evidence: FrameEvidence) {
  return evidence.peaks > 0 ? evidence.blended / evidence.peaks : 0
}
