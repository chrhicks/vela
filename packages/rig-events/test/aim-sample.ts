import { epochMs, rigId, seal, sourceId } from '@vela/rig-events'

export const aimEvent = seal({
  kind: 'aim', rig: rigId('test-rig'), source: sourceId('vela:aim'),
  at: epochMs(1000), seenAt: epochMs(1000),
  body: {
    goalId: 'goal-1', target: { raDegrees: 10, decDegrees: 20 },
    status: 'missed', reason: 'outside-tolerance', elapsedMs: 1000, corrections: 0,
    residualArcmin: 73.2, toleranceArcmin: 0.5, maxCorrections: 4, maxElapsedMs: 240000,
    gotoWarningArcmin: 15, gotoMissArcmin: 73.2, gotoWarning: true,
    confidence: 'low', pointingBudgetArcmin: 2, blindTravelDegrees: 1,
  },
})
