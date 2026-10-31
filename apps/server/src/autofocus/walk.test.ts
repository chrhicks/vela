import { describe, expect, it } from 'vitest'
import {
  APPROACH_OVERSHOOT_STEPS,
  approachFromAbove,
  planStarHfrWalk,
  assertCommandedPosition,
} from './walk.js'

describe('autofocus walk window', () => {
  it('plans a window around the current EAF position and never includes 0', () => {
    const planned = planStarHfrWalk(32842, 50, 4, 60000)

    expect(planned.ok).toBe(true)

    if (!planned.ok) return
    expect(planned.plan.start).toBe(32842)
    expect(planned.plan.positions[0]).toBe(33042)
    expect(planned.plan.positions.at(-1)).toBe(32642)
    expect(planned.plan.positions).not.toContain(0)
    expect(planned.plan.minPosition).toBeGreaterThan(0)
    expect(planned.plan.maxPosition).toBeLessThan(60000)
  })

  it('aborts before a window would approach 0 or MaxStep, including a start of 0', () => {
    expect(planStarHfrWalk(0, 50, 4, 60000)).toMatchObject({ ok: false, reason: 'start-at-limit' })
    expect(planStarHfrWalk(80, 50, 4, 60000)).toMatchObject({
      ok: false,
      reason: 'window-hits-limit',
    })
    expect(planStarHfrWalk(59800, 50, 4, 60000)).toMatchObject({
      ok: false,
      reason: 'window-hits-limit',
    })
    expect(planStarHfrWalk(60000, 50, 4, 60000)).toMatchObject({
      ok: false,
      reason: 'start-at-limit',
    })
  })

  it('plans a Cria travel window inclusive of MinStep and MaxStep', () => {
    const low = planStarHfrWalk(15700, 50, 4, 38000, 15500)

    if (!low.ok) throw new Error(low.message)
    expect(low.plan.positions).toEqual([15900, 15850, 15800, 15750, 15700, 15650, 15600, 15550, 15500])
    expect(low.plan.travel).toEqual({ min: 15500, max: 38000 })
    expect(() => assertCommandedPosition(15500, low.plan.travel)).not.toThrow()
    expect(() => assertCommandedPosition(15499, low.plan.travel)).toThrow(/outside the focuser travel/)

    const high = planStarHfrWalk(37800, 50, 4, 38000, 15500)

    if (!high.ok) throw new Error(high.message)
    expect(high.plan.positions[0]).toBe(38000)
    expect(() => assertCommandedPosition(38000, high.plan.travel)).not.toThrow()
    expect(() => assertCommandedPosition(38001, high.plan.travel)).toThrow(/outside the focuser travel/)
  })

  it('refuses a start or window outside a Cria travel window', () => {
    expect(planStarHfrWalk(15499, 50, 4, 38000, 15500)).toMatchObject({
      ok: false,
      reason: 'start-at-limit',
    })
    expect(planStarHfrWalk(38001, 50, 4, 38000, 15500)).toMatchObject({
      ok: false,
      reason: 'start-at-limit',
    })
    expect(planStarHfrWalk(15699, 50, 4, 38000, 15500)).toMatchObject({
      ok: false,
      reason: 'window-hits-limit',
    })
    expect(planStarHfrWalk(37801, 50, 4, 38000, 15500)).toMatchObject({
      ok: false,
      reason: 'window-hits-limit',
    })
  })

  it('never commands 0 even when Cria reports a MinStep of 0', () => {
    expect(planStarHfrWalk(0, 50, 4, 38000, 0)).toMatchObject({ ok: false, reason: 'start-at-limit' })
    expect(planStarHfrWalk(200, 50, 4, 38000, 0)).toMatchObject({
      ok: false,
      reason: 'window-hits-limit',
    })

    const planned = planStarHfrWalk(250, 50, 4, 38000, 0)

    if (!planned.ok) throw new Error(planned.message)
    expect(planned.plan.travel).toEqual({ min: 1, max: 38000 })
    expect(planned.plan.positions.at(-1)).toBe(50)
  })

  it('keeps one step inside the ceiling and above 0 when no MinStep is reported', () => {
    expect(planStarHfrWalk(59800, 50, 4, 60000)).toMatchObject({
      ok: false,
      reason: 'window-hits-limit',
    })
    expect(planStarHfrWalk(200, 50, 4, 60000)).toMatchObject({
      ok: false,
      reason: 'window-hits-limit',
    })

    const planned = planStarHfrWalk(59799, 50, 4, 60000)

    if (!planned.ok) throw new Error(planned.message)
    expect(planned.plan.travel).toEqual({ min: 1, max: 59999 })
    expect(planned.plan.positions[0]).toBe(59999)
    expect(() => assertCommandedPosition(60000, planned.plan.travel)).toThrow(/outside the focuser travel/)
  })

  it('refuses Move(0) even if a caller asks, and anything outside travel', () => {
    const planned = planStarHfrWalk(32842, 50, 4, 60000)
    expect(planned.ok).toBe(true)

    if (!planned.ok) return
    expect(() => assertCommandedPosition(0, planned.plan.travel)).toThrow(/not a home/)
    expect(() => assertCommandedPosition(60000, planned.plan.travel)).toThrow(/outside the focuser travel/)
    expect(() => assertCommandedPosition(30000, planned.plan.travel)).not.toThrow()
  })
})

describe('autofocus final approach', () => {
  const travel = { min: 1, max: 59999 }

  it('passes through a position above the target', () => {
    expect(approachFromAbove(travel, 32838)).toEqual({
      target: 32838,
      via: 32838 + APPROACH_OVERSHOOT_STEPS,
    })
  })

  it('clamps the overshoot to the travel and goes direct from the top of it', () => {
    const cria = { min: 15500, max: 38000 }

    expect(approachFromAbove(cria, 37800)).toEqual({ target: 37800, via: 38000 })
    expect(approachFromAbove(cria, 38000)).toEqual({ target: 38000, via: null })
  })
})
