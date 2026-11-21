import { SiderealTime } from 'astronomy-engine'
import { describe, expect, it } from 'vitest'
import { noHorizon, type Horizon } from '../src/horizon/horizon.ts'
import { fromMount } from '../src/sky/coordinates.ts'
import { placementOf, type UpLine } from '../src/sky/placement.ts'
import { behindTrees, behindTreesWords } from './behind-trees.ts'
import type { Placement } from './targets.ts'

const phoenix = { latitudeDegrees: 33.45, longitudeDegrees: -112.07, elevationMeters: 331 }
const at = Date.UTC(2026, 10, 15, 4, 0, 0)
const elsewhere = { raDegrees: 0, decDegrees: 0 }
const dawn = at + 10 * 3_600_000
const upLine = (horizon: Horizon): UpLine => ({ horizon, upLineDegrees: 30, stepSeconds: 60, lookAheadHours: 12 })
const flat = upLine(noHorizon)
const utcTime = (when: number) => new Date(when).toISOString().slice(11, 16)

const horizonOf = (altitudeDegrees: number, blocks: ReadonlyArray<{ readonly from: number; readonly to: number; readonly altitudeDegrees: number }> = []): Horizon => ({
  ...noHorizon,
  altitudesDegrees: noHorizon.altitudesDegrees.map((_, bin) => blocks.find(block => bin >= block.from && bin <= block.to)?.altitudeDegrees ?? altitudeDegrees),
})

const overheadAt = (when: number, hoursPastMeridian: number, decDegrees: number) => {
  const localSiderealHours = SiderealTime(new Date(when)) + phoenix.longitudeDegrees / 15

  return fromMount({ raDegrees: ((((localSiderealHours - hoursPastMeridian) * 15) % 360) + 360) % 360, decDegrees }, new Date(when))
}

const south = overheadAt(at, 0, 20 - (90 - phoenix.latitudeDegrees))
const rising = overheadAt(at, -6, 20)
const belowHorizon = overheadAt(at, -9, 20)
const eastBlock = [{ from: 20, to: 140, altitudeDegrees: 40 }]

const wordsOf = (target: typeof south, up: UpLine, darkUntil: number | undefined = dawn) => {
  const placement = placementOf(target, phoenix, at, up, elsewhere)
  const behind = behindTrees({ placement, darkUntil })

  return behind === undefined ? undefined : behindTreesWords(behind, utcTime)
}

describe("Start's line about the horizon", () => {
  it('says from when a target above the horizon now drops behind it tonight', () => {
    expect(wordsOf(south, upLine(horizonOf(10)))).toBe('behind the trees from 06:45')
  })

  it('says now, and when it clears, for a target behind the horizon that rises over it tonight', () => {
    expect(wordsOf(rising, upLine(horizonOf(10, eastBlock)))).toBe('behind the trees now, clears at 06:21')
  })

  it('says below the up line, not the trees, where the horizon is not mapped', () => {
    expect(wordsOf(south, flat)).toBeUndefined()
    expect(wordsOf(overheadAt(at, 1, 20), flat)).toBe('below 30° from 07:25')
    expect(wordsOf(rising, flat)).toBe('below 30° now, clears at 05:33')
  })

  it('says below the horizon, not the trees, for a target that has not risen yet', () => {
    expect(placementOf(belowHorizon, phoenix, at, upLine(horizonOf(10)), elsewhere).altitudeDegrees).toBeLessThan(0)
    expect(wordsOf(belowHorizon, upLine(horizonOf(10)))).toBe('below the horizon now, clears at 06:55')
  })

  it('uses the up line when the target drops behind a part of the horizon that is not mapped', () => {
    const mappedSouth: Horizon = { ...noHorizon, altitudesDegrees: noHorizon.altitudesDegrees.map((_, bin) => (bin >= 170 && bin <= 190 ? 10 : null)) }

    expect(placementOf(south, phoenix, at, upLine(mappedSouth), elsewhere).lineSource).toBe('horizon')
    expect(wordsOf(south, upLine(mappedSouth))).toMatch(/^below 30° from /)
  })

  it('says nothing for a target above the horizon all night or one that does not get above it', () => {
    expect(wordsOf(overheadAt(at, 0, 80), upLine(horizonOf(20)))).toBeUndefined()
    expect(wordsOf(overheadAt(at, 0, -60), upLine(horizonOf(10)))).toBeUndefined()
  })

  it('says nothing when the sky or the target is not known', () => {
    expect(behindTrees({ placement: null, darkUntil: dawn })).toBeUndefined()
  })

  it('ends the night at dawn: a drop or a rise after it is not mentioned', () => {
    const placement = placementOf(south, phoenix, at, upLine(horizonOf(10)), elsewhere)
    const drop = placement.line.above === 'until' ? placement.line.until : at
    const rise = placementOf(rising, phoenix, at, upLine(horizonOf(10, eastBlock)), elsewhere)
    const clears = rise.line.above === 'rises' ? rise.line.at : at

    expect(behindTrees({ placement, darkUntil: drop })).toMatchObject({ when: 'from', at: drop })
    expect(behindTrees({ placement, darkUntil: drop - 1 })).toBeUndefined()
    expect(behindTrees({ placement: rise, darkUntil: clears })).toMatchObject({ when: 'now', clearsAt: clears })
    expect(behindTrees({ placement: rise, darkUntil: clears - 1 })).toBeUndefined()
    expect(behindTrees({ placement, darkUntil: undefined })).toMatchObject({ when: 'from', at: drop })
  })

  it('names the horizon at the crossing, as the picker does', () => {
    const line: Placement['line'] = { above: 'until', until: at + 3_600_000, lineSource: 'horizon', lineDegrees: 14 }
    const placement: Placement = { altitudeDegrees: 40, lineDegrees: 30, lineSource: 'up-line', moonDegrees: 90, line }

    expect(behindTrees({ placement, darkUntil: dawn })).toEqual({ when: 'from', at: at + 3_600_000, cause: 'trees', lineDegrees: 14 })
  })
})
