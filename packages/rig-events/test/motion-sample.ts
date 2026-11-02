import { homeOperation, mountState, operationId } from '@vela/rig-testing'

export const motion = {
  commanded: { kind: 'home', sentAt: 100 },
  observed: {
    from: { rightAscensionDegrees: 30, declinationDegrees: 40 },
    to: { rightAscensionDegrees: 45, declinationDegrees: 40 },
    travel: { rightAscensionDegrees: 15, declinationDegrees: 0 },
  },
  stopped: { how: 'arrived', at: 200 },
} as const

export function motionState(withRecord = true) {
  const operation = homeOperation({ id: operationId(1), acceptedAt: 90, startedAt: 95, settledAt: 210 })

  return mountState({ sequence: 1, generatedAt: 220, mount: { at: 200, raHours: 3, decDegrees: 40 }, operations: [withRecord ? { ...operation, motion } : operation] })
}

