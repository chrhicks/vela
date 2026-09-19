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
    expect(planStarHfrWalk(80, 50, 4, 60000)).toMatchObject({ ok: false, reason: 'window-hits-limit' })
    expect(planStarHfrWalk(59800, 50, 4, 60000)).toMatchObject({ ok: false, reason: 'window-hits-limit' })
    expect(planStarHfrWalk(60000, 50, 4, 60000)).toMatchObject({ ok: false, reason: 'start-at-limit' })
  })

  it('refuses Move(0) even if a caller asks', () => {
    const planned = planStarHfrWalk(32842, 50, 4, 60000)
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    expect(() => assertCommandedPosition(0, planned.plan)).toThrow(/not a home/)
    expect(() => assertCommandedPosition(60000, planned.plan)).toThrow(/mechanical travel limit/)
    expect(() => assertCommandedPosition(30000, planned.plan)).toThrow(/window around the starting position/)
  })

  it('offers extra inward samples only while the V minimum is still at the inner edge', () => {
    const planned = planStarHfrWalk(32842, 50, 4, 60000)
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    const inner = planned.plan.positions.map(position => ({
      position, hfrPixels: position === 32642 ? 2.1 : 4,
    }))

    expect(extraInwardPosition(planned.plan, inner)).toBe(32592)
    inner.push({ position: 32592, hfrPixels: 2.4 })
    expect(extraInwardPosition(planned.plan, inner)).toBeUndefined()
  })
})
