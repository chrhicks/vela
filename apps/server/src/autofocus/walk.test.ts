import { describe, expect, it } from 'vitest'
import { extraInwardPosition, planStarHfrWalk, assertCommandedPosition } from './walk.js'

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
    expect(() => assertCommandedPosition(15500, low.plan, 15500)).not.toThrow()
    expect(() => assertCommandedPosition(15499, low.plan, 15400)).toThrow(/outside the focuser travel/)
    expect(extraInwardPosition(low.plan, [{ position: 15500, hfrPixels: 2 }])).toBeUndefined()

    const high = planStarHfrWalk(37800, 50, 4, 38000, 15500)

    if (!high.ok) throw new Error(high.message)
    expect(high.plan.positions[0]).toBe(38000)
    expect(() => assertCommandedPosition(38000, high.plan)).not.toThrow()
    expect(() => assertCommandedPosition(38001, high.plan)).toThrow(/outside the focuser travel/)
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
    expect(() => assertCommandedPosition(60000, planned.plan)).toThrow(/outside the focuser travel/)
  })

  it('refuses Move(0) even if a caller asks', () => {
    const planned = planStarHfrWalk(32842, 50, 4, 60000)
    expect(planned.ok).toBe(true)

    if (!planned.ok) return
    expect(() => assertCommandedPosition(0, planned.plan)).toThrow(/not a home/)
    expect(() => assertCommandedPosition(60000, planned.plan)).toThrow(/outside the focuser travel/)
    expect(() => assertCommandedPosition(30000, planned.plan)).toThrow(
      /window around the starting position/,
    )
  })

  it('offers extra inward samples only while the V minimum is still at the inner edge', () => {
    const planned = planStarHfrWalk(32842, 50, 4, 60000)
    expect(planned.ok).toBe(true)

    if (!planned.ok) return

    const inner = planned.plan.positions.map(position => ({
      position,
      hfrPixels: position === 32642 ? 2.1 : 4,
    }))

    expect(extraInwardPosition(planned.plan, inner)).toBe(32592)
    inner.push({ position: 32592, hfrPixels: 2.4 })
    expect(extraInwardPosition(planned.plan, inner)).toBeUndefined()
  })
})
