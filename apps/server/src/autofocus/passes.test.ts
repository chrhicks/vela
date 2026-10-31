import { describe, expect, it } from 'vitest'
import { lowestMeasured, nextInPass, planPass } from './passes.js'

const travel = { min: 100, max: 1000 }
const settings = { stepSize: 50, offsetSteps: 2 }

describe('planning a pass', () => {
  it('lists the positions top first around the centre', () => {
    expect(planPass(500, settings, travel)).toEqual([600, 550, 500, 450, 400])
  })

  it('leaves out positions outside the travel', () => {
    expect(planPass(150, settings, travel)).toEqual([250, 200, 150, 100])
    expect(planPass(950, settings, travel)).toEqual([1000, 950, 900, 850])
  })
})

describe('the next move in a pass', () => {
  const planned = planPass(500, settings, travel)
  const at = (position: number, hfrPixels: number | null) => ({ position, hfrPixels })

  it('samples the planned positions in order', () => {
    expect(nextInPass(planned, 50, travel, [])).toEqual({ kind: 'sample', position: 600 })
    expect(nextInPass(planned, 50, travel, [at(600, 4), at(550, 3)])).toEqual({ kind: 'sample', position: 500 })
  })

  it('closes when the lowest sample has a sample on each side', () => {
    const samples = [at(600, 4), at(550, 3), at(500, 2), at(450, 3), at(400, 4)]

    expect(nextInPass(planned, 50, travel, samples)).toEqual({ kind: 'closed', lowest: 500 })
  })

  it('steps down from a minimum at the low edge, and up from one at the high edge', () => {
    const falling = [at(600, 5), at(550, 4), at(500, 3), at(450, 2.5), at(400, 2)]
    const rising = [at(600, 2), at(550, 2.5), at(500, 3), at(450, 4), at(400, 5)]

    expect(nextInPass(planned, 50, travel, falling)).toEqual({ kind: 'sample', position: 350 })
    expect(nextInPass(planned, 50, travel, rising)).toEqual({ kind: 'sample', position: 650 })
  })

  it('keeps stepping while the sample it just took is the new lowest, and closes once HFR rises', () => {
    const falling = [at(600, 5), at(550, 4), at(500, 3), at(450, 2.5), at(400, 2)]

    expect(nextInPass(planned, 50, travel, [...falling, at(350, 1.5)])).toEqual({ kind: 'sample', position: 300 })
    expect(nextInPass(planned, 50, travel, [...falling, at(350, 1.5), at(300, 2.2)])).toEqual({ kind: 'closed', lowest: 350 })
  })

  it('counts a sample with no stars as worse than any measured one', () => {
    const samples = [at(600, null), at(550, 3), at(500, 2), at(450, 3), at(400, null)]

    expect(nextInPass(planned, 50, travel, samples)).toEqual({ kind: 'closed', lowest: 500 })
  })

  it('reports no stars when nothing measured, and the end of travel when it cannot step on', () => {
    expect(nextInPass(planned, 50, travel, planned.map(position => at(position, null)))).toEqual({ kind: 'no-stars' })

    const lowPlan = planPass(150, settings, travel)
    const bottom = lowPlan.map((position, index) => at(position, 4 - index))
    const topPlan = planPass(950, settings, travel)
    const top = topPlan.map((position, index) => at(position, 1 + index))

    expect(nextInPass(lowPlan, 50, travel, bottom)).toEqual({ kind: 'travel-limit', edge: 'low', lowest: 100 })
    expect(nextInPass(topPlan, 50, travel, top)).toEqual({ kind: 'travel-limit', edge: 'high', lowest: 1000 })
  })

  it('takes the first of two equal minima', () => {
    expect(lowestMeasured([at(600, 3), at(550, 2), at(500, 2)])).toEqual({ position: 550, hfrPixels: 2 })
  })
})
