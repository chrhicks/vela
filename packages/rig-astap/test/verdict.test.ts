import { describe, expect, it } from 'vitest'
import {
  fewestStars,
  judgeSolve,
  maxHintOffsetDegrees,
  purposes,
  reasons,
  scaleTolerance,
  type SolveOutcome,
  type Expectation,
  type Purpose,
  type Reason,
  type SolveFacts,
} from '@vela/rig-astap'

const expected: Expectation = { arcsecPerPixel: 1.94, parity: 1 }

const claimed = { raDegrees: 90, decDegrees: 10 }

function solved(overrides: { scale?: number; stretch?: number; parity?: 1 | -1; centre?: { raDegrees: number; decDegrees: number } } = {}): SolveOutcome {
  const { scale = expected.arcsecPerPixel, stretch = 1, parity = 1, centre = claimed } = overrides
  const degrees = scale / 3600
  const wcs = { width: 6248, height: 4176, referenceX: 3124.5, referenceY: 2088.5, ...centre, cd: [0, degrees / stretch, -degrees * parity * stretch, 0] as const }

  return { status: 'solved', wcs }
}

function facts(overrides: Partial<SolveFacts> = {}): SolveFacts {
  return { solution: solved(), stars: 200, claimed, ...overrides }
}

const reasonsOf = (verdict: ReturnType<typeof judgeSolve>) => (verdict.status === 'rejected' ? verdict.reasons : [])

describe('judgeSolve', () => {
  describe.each(purposes)('for %s', purpose => {
    it('accepts a solve with the expected scale and parity, near the claim', () => {
      const verdict = judgeSolve(facts(), expected, purpose)

      expect(verdict).toMatchObject({ status: 'accepted', unchecked: [], measured: { parity: 1, stars: 200, hintOffsetDegrees: 0 } })
      expect(verdict.status === 'accepted' && verdict.measured.scaleError).toBeCloseTo(0, 12)
    })

    it('rejects a scale outside the purpose limit and accepts one just inside', () => {
      const limit = scaleTolerance[purpose]

      expect(reasonsOf(judgeSolve(facts({ solution: solved({ scale: expected.arcsecPerPixel * (1 + limit * 1.05) }) }), expected, purpose))).toEqual(['scale'])
      expect(reasonsOf(judgeSolve(facts({ solution: solved({ scale: expected.arcsecPerPixel * (1 - limit * 1.05) }) }), expected, purpose))).toEqual(['scale'])
      expect(judgeSolve(facts({ solution: solved({ scale: expected.arcsecPerPixel * (1 + limit * 0.95) }) }), expected, purpose).status).toBe('accepted')
    })

    it('rejects a stretched matrix whose determinant has the right scale', () => {
      expect(reasonsOf(judgeSolve(facts({ solution: solved({ stretch: 1.2 }) }), expected, purpose))).toEqual(['scale'])
    })

    it('rejects a sheared matrix whose axes and determinant look right', () => {
      const scale = expected.arcsecPerPixel / 3600
      const shear = Math.PI / 12
      const sheared: SolveOutcome = { status: 'solved', wcs: { width: 6248, height: 4176, referenceX: 3124.5, referenceY: 2088.5, ...claimed, cd: [scale, scale * Math.sin(shear), 0, scale * Math.cos(shear)] } }

      expect(reasonsOf(judgeSolve(facts({ solution: sheared }), expected, purpose))).toEqual(['scale'])
    })

    it('rejects a mirrored solve, and a solve of the other parity when that is what the rig expects', () => {
      expect(reasonsOf(judgeSolve(facts({ solution: solved({ parity: -1 }) }), expected, purpose))).toEqual(['parity'])
      expect(judgeSolve(facts({ solution: solved({ parity: -1 }) }), { ...expected, parity: -1 }, purpose).status).toBe('accepted')
    })

    it('rejects a solve farther from the mount claim than the solver searches, and accepts one inside', () => {
      const near = { raDegrees: 90, decDegrees: 10 + maxHintOffsetDegrees * 0.95 }
      const far = { raDegrees: 90, decDegrees: 10 + maxHintOffsetDegrees * 1.05 }

      expect(judgeSolve(facts({ solution: solved({ centre: near }) }), expected, purpose).status).toBe('accepted')
      expect(reasonsOf(judgeSolve(facts({ solution: solved({ centre: far }) }), expected, purpose))).toEqual(['off-hint'])
    })

    it('measures the offset across the RA wrap as a short arc', () => {
      const verdict = judgeSolve(facts({ solution: solved({ centre: { raDegrees: 0.5, decDegrees: 0 } }), claimed: { raDegrees: 359.5, decDegrees: 0 } }), expected, purpose)

      expect(verdict).toMatchObject({ status: 'accepted', measured: { hintOffsetDegrees: expect.closeTo(1, 9) } })
    })

    it('rejects fewer stars than any correct solve of the corpus had, and accepts that many', () => {
      expect(reasonsOf(judgeSolve(facts({ stars: fewestStars - 1 }), expected, purpose))).toEqual(['few-stars'])
      expect(judgeSolve(facts({ stars: fewestStars }), expected, purpose).status).toBe('accepted')
    })

    it('names what it could not check when there is no star count or no claim', () => {
      expect(judgeSolve(facts({ stars: null }), expected, purpose)).toMatchObject({ status: 'accepted', unchecked: ['stars'] })
      expect(judgeSolve(facts({ claimed: null }), expected, purpose)).toMatchObject({ status: 'accepted', unchecked: ['hint'] })
      expect(judgeSolve(facts({ stars: null, claimed: null }), expected, purpose)).toMatchObject({ status: 'accepted', unchecked: ['stars', 'hint'] })
    })

    it('rejects when ASTAP found no solution, saying why', () => {
      const none = (reason: 'no-match' | 'too-few-stars'): SolveFacts => facts({ solution: { status: 'no-solution', reason } })

      expect(judgeSolve(none('no-match'), expected, purpose)).toEqual({ status: 'rejected', reasons: ['no-match'], measured: null })
      expect(judgeSolve(none('too-few-stars'), expected, purpose)).toEqual({ status: 'rejected', reasons: ['few-stars'], measured: null })
    })

    it('rejects a solve whose numbers are not numbers', () => {
      expect(reasonsOf(judgeSolve(facts({ solution: solved({ scale: Number.NaN }) }), expected, purpose))).toContain('scale')
      expect(reasonsOf(judgeSolve(facts({ solution: solved({ centre: { raDegrees: Number.NaN, decDegrees: 10 } }) }), expected, purpose))).toEqual(['off-hint'])
    })

    it('rejects the shape of the audit false solve with every reason it earns', () => {
      const falseSolve = facts({ solution: solved({ scale: expected.arcsecPerPixel * 1.2, parity: -1, centre: { raDegrees: 190, decDegrees: 10 } }), stars: 29 })

      expect(judgeSolve(falseSolve, expected, purpose)).toMatchObject({ status: 'rejected', reasons: ['scale', 'parity', 'off-hint'] })
    })
  })

  it('grades by purpose: a scale between the two limits frames a target and is not good enough for alignment', () => {
    const between = facts({ solution: solved({ scale: expected.arcsecPerPixel * 1.03 }) })

    expect(judgeSolve(between, expected, 'framing').status).toBe('accepted')
    expect(reasonsOf(judgeSolve(between, expected, 'alignment'))).toEqual(['scale'])
  })

  it('has a test for every reason and every purpose', () => {
    const seen = new Set<Reason>()

    const cases: [SolveFacts, Purpose][] = [
      [facts({ solution: { status: 'no-solution', reason: 'no-match' } }), 'framing'],
      [facts({ stars: 1 }), 'framing'],
      [facts({ solution: solved({ scale: 9 }) }), 'alignment'],
      [facts({ solution: solved({ parity: -1 }) }), 'alignment'],
      [facts({ solution: solved({ centre: { raDegrees: 270, decDegrees: 10 } }) }), 'framing'],
    ]

    for (const [input, purpose] of cases) for (const reason of reasonsOf(judgeSolve(input, expected, purpose))) seen.add(reason)

    expect([...seen].sort()).toEqual([...reasons].sort())
  })
})
