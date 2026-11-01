import type { AutofocusFit } from '@vela/model/web'
import { fitHyperbola, sampleWeight } from './hyperbola.js'
import { lowestMeasured } from './passes.js'

/** A fine-pass sample as the estimator reads it: where, what it measured, and the stars behind that. */
export interface FocusSample {
  position: number
  hfrPixels: number | null
  detectedStars: number
  starHfrs: number[]
}

export interface FocusChoice {
  position: number
  /** The fitted vertex, or the best measured sample when the fit was unusable. */
  source: 'fit' | 'best-sample'
  /** The fit, when it passed its gates. */
  fit: AutofocusFit | null
  /** The lowest-HFR sample of the pass: what landing is judged against and falls back to. */
  best: { position: number; hfrPixels: number }
}

const rSquaredGate = 0.7

/**
 * Where to land after the fine pass. The robust fit (weighted by each sample's spread, on the V
 * around the minimum only) gives the position when its weighted R² clears the gate and the vertex
 * lies inside the sampled positions. Otherwise the best measured sample is the position, because a
 * measured place is better than an estimate nobody trusts. Null only when no sample measured a star.
 */
export function chooseFocus(samples: FocusSample[]): FocusChoice | null {
  const lowest = lowestMeasured(samples)

  if (!lowest) return null

  const curve = fitHyperbola(
    samples.flatMap(sample =>
      sample.hfrPixels === null
        ? []
        : [
            {
              x: sample.position,
              y: sample.hfrPixels,
              weight: sampleWeight(sample.detectedStars, sample.starHfrs),
            },
          ],
    ),
  )

  const positions = samples.map(sample => sample.position)
  const position = curve ? Math.round(curve.p) : null

  if (
    !curve ||
    position === null ||
    curve.rSquared < rSquaredGate ||
    position < Math.min(...positions) ||
    position > Math.max(...positions)
  ) {
    return { position: lowest.position, source: 'best-sample', fit: null, best: lowest }
  }

  return {
    position,
    source: 'fit',
    fit: {
      position,
      p: curve.p,
      a: curve.a,
      b: curve.b,
      rSquared: curve.rSquared,
      minSamplePosition: lowest.position,
    },
    best: lowest,
  }
}

/** A confirm frame is fine when its HFR is no worse than the best sample's by more than the tolerance (0.1 is 10 %). */
export function confirmsBest(confirmHfr: number | null, bestHfr: number, tolerance: number) {
  return confirmHfr !== null && confirmHfr <= bestHfr * (1 + tolerance)
}
