import { expect, it } from 'vitest'
import { judgeAim, type AimGoal } from './judge.js'

const goal: AimGoal = {
  goalId: 'test', target: { raDegrees: 10, decDegrees: 20 },
  assessment: { confidence: 'low', budgetArcmin: 2, blindTravelDegrees: 1 },
  refusal: null, elapsedMs: 1000, completed: true,
  events: [{ kind: 'move', correction: 0 }, { kind: 'solve', verdict: 'accepted', residualArcmin: 73.2 }],
}

it('flags a checked goto miss using the sky, including the warning threshold', () => {
  expect(judgeAim(goal)).toMatchObject({ status: 'missed', residualArcmin: 73.2, gotoWarning: true })
})

it('requires a final accepted solve inside both budgets', () => {
  const events = [{ kind: 'solve', verdict: 'accepted', residualArcmin: 0.1 }] as const
  expect(judgeAim({ ...goal, events })).toMatchObject({ status: 'aimed' })
  expect(judgeAim({ ...goal, events, elapsedMs: 240001 })).toMatchObject({ status: 'missed', reason: 'budget' })
  expect(judgeAim({ ...goal, events: [...Array.from({ length: 5 }, () => ({ kind: 'move', correction: 1 } as const)), ...events] })).toMatchObject({ status: 'missed', reason: 'budget' })
  expect(judgeAim({ ...goal, events: [...events, { kind: 'solve', verdict: 'rejected', residualArcmin: null }] })).toMatchObject({ status: 'missed', reason: 'no-solve' })
  expect(judgeAim({ ...goal, events, completed: false })).toMatchObject({ status: 'missed', reason: 'interrupted' })
})

it('records hypothetical refusals without losing observed residuals', () => {
  expect(judgeAim({ ...goal, assessment: null })).toMatchObject({ status: 'refused', reason: 'no-confidence', residualArcmin: 73.2 })

  for (const refusal of ['mount-held', 'mount-unavailable', 'outside-envelope'] as const)
    expect(judgeAim({ ...goal, refusal })).toMatchObject({ status: 'refused', reason: refusal })
})
