import type { SkyPosition } from '@vela/rig-events'
import type { AstapSolution } from './solver.ts'

type Solved = Extract<AstapSolution, { readonly status: 'solved' }>

type Unsolved = Extract<AstapSolution, { readonly status: 'no-solution' }>

/** The part of an ASTAP result the verdict reads. A solve recorded without its search radius is still judged. */
export type SolveOutcome = Pick<Solved, 'status' | 'wcs'> | Pick<Unsolved, 'status' | 'reason'>

export const purposes = ['framing', 'alignment'] as const

export type Purpose = (typeof purposes)[number]

export const reasons = ['no-match', 'few-stars', 'scale', 'parity', 'off-hint'] as const

export type Reason = (typeof reasons)[number]

/** What the rig's optics and camera path promise about every solve, from config. */
export interface Expectation {
  readonly arcsecPerPixel: number
  /** Sign of the CD determinant. The camera path never mirrors, so a frame of this rig always has the same sign. */
  readonly parity: 1 | -1
}

export interface SolveFacts {
  readonly solution: SolveOutcome
  /** Stars ASTAP found, from its `-log`. `null` when nothing counted them. */
  readonly stars: number | null
  /** Where the mount says it points, in J2000. `null` when there is no claim to compare with. */
  readonly claimed: SkyPosition | null
}

export interface Measured {
  readonly arcsecPerPixel: number
  /** Signed fraction: 0.02 is 2% larger than expected. */
  readonly scaleError: number
  readonly parity: 1 | -1
  readonly hintOffsetDegrees: number | null
  readonly stars: number | null
}

/** A check that had no input, so the verdict says nothing about it. */
export type Unchecked = 'stars' | 'hint'

export type SolveVerdict =
  | { readonly status: 'accepted'; readonly measured: Measured; readonly unchecked: readonly Unchecked[] }
  | { readonly status: 'rejected'; readonly reasons: readonly [Reason, ...Reason[]]; readonly measured: Measured | null }

/**
 * The configured focal length sits 0.2% to 0.7% from the scale of every good frame of the audit corpus, and the
 * audit's false solves were 8% and 20% off. Alignment fits orientation and scale across frames, so it gets a
 * band 3 times the worst good frame. Framing only needs the field centre, so it gets 7 times, which still
 * rejects both false solves.
 */
export const scaleTolerance = { framing: 0.05, alignment: 0.02 } as const satisfies Record<Purpose, number>

/**
 * The solver's first search radius is 10 degrees. A solution farther from the mount's claim than that was found by
 * a wider search, which is how the false solve of the audit (100 degrees away) came about. The largest good offset
 * in the corpus is 3.9 degrees, a polar misalignment, not an error.
 */
export const maxHintOffsetDegrees = 10

/** The fewest stars of any correct solve in the corpus. Below it nothing has been measured. */
export const fewestStars = 10

const noSolutionReason = { 'no-match': 'no-match', 'too-few-stars': 'few-stars' } as const satisfies Record<Unsolved['reason'], Reason>

const radians = Math.PI / 180

function separationDegrees(a: SkyPosition, b: SkyPosition): number {
  const half =
    Math.sin(((b.decDegrees - a.decDegrees) * radians) / 2) ** 2 +
    Math.cos(a.decDegrees * radians) * Math.cos(b.decDegrees * radians) * Math.sin(((b.raDegrees - a.raDegrees) * radians) / 2) ** 2

  return (2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, half))))) / radians
}

function measure(wcs: Solved['wcs'], facts: SolveFacts, expected: Expectation): Measured {
  const [a, b, c, d] = wcs.cd
  const determinant = a * d - b * c
  const arcsecPerPixel = Math.sqrt(Math.abs(determinant)) * 3600

  return {
    arcsecPerPixel,
    scaleError: arcsecPerPixel / expected.arcsecPerPixel - 1,
    parity: determinant > 0 ? 1 : -1,
    hintOffsetDegrees: facts.claimed === null ? null : separationDegrees(wcs, facts.claimed),
    stars: facts.stars,
  }
}

/**
 * Whether a solve is good enough for a purpose. Every limit is written so that a NaN fails it. A solve can pass
 * `framing` and fail `alignment`.
 */
export function judgeSolve(facts: SolveFacts, expected: Expectation, purpose: Purpose): SolveVerdict {
  const { solution } = facts

  if (solution.status === 'no-solution') return { status: 'rejected', reasons: [noSolutionReason[solution.reason]], measured: null }

  const measured = measure(solution.wcs, facts, expected)
  const failed: Reason[] = []

  if (!(Math.abs(measured.scaleError) <= scaleTolerance[purpose])) failed.push('scale')

  if (measured.parity !== expected.parity) failed.push('parity')

  if (measured.hintOffsetDegrees !== null && !(measured.hintOffsetDegrees <= maxHintOffsetDegrees)) failed.push('off-hint')

  if (measured.stars !== null && !(measured.stars >= fewestStars)) failed.push('few-stars')

  const [first, ...rest] = failed

  if (first !== undefined) return { status: 'rejected', reasons: [first, ...rest], measured }

  return {
    status: 'accepted',
    measured,
    unchecked: [...(measured.stars === null ? (['stars'] as const) : []), ...(measured.hintOffsetDegrees === null ? (['hint'] as const) : [])],
  }
}
