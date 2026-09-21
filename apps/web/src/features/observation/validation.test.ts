import { describe, expect, it } from 'vitest'
import { device, observation } from '../../../tests/fixtures/observation'
import { isConnectRigDevicesResult, isRigObservationView } from './validation'

describe('observation response validation', () => {
  it('accepts preparation states without deriving connection policy from device kinds', () => {
    for (const state of ['available', 'complete', 'unavailable', 'in-progress'] as const) {
      expect(isRigObservationView(observation(state))).toBe(true)
    }

    expect(
      isRigObservationView({
        ...observation(),
        connectionPreparation: { state: 'complete', capabilities: ['connect-devices'] },
      }),
    ).toBe(false)
    expect(
      isRigObservationView({
        ...observation(),
        connectionPreparation: { state: 'available', capabilities: [] },
      }),
    ).toBe(false)
    expect(isRigObservationView({ ...observation(), rig: {} })).toBe(false)
  })

  it('accepts complete, failed, partial, reconciled and uncertain outcomes', () => {
    const base = { view: observation(), confirmedConnected: [device(0)], notAttempted: [device(2)] }

    for (const result of [
      {
        outcome: 'complete',
        command: 'completed',
        confirmedConnected: [device(0)],
        view: observation('complete'),
      },
      {
        outcome: 'complete',
        command: 'not-needed',
        confirmedConnected: [],
        view: observation('complete'),
      },
      {
        ...base,
        outcome: 'failed',
        confirmedConnected: [],
        failed: { ...device(1), reason: 'rejected' },
      },
      { ...base, outcome: 'partial', failed: { ...device(1), reason: 'remained-disconnected' } },
      { ...base, outcome: 'partial', stoppedAfter: device(0) },
      {
        ...base,
        outcome: 'uncertain',
        uncertain: { ...device(1), reason: 'write-outcome-unknown' },
      },
      { outcome: 'unavailable', reason: 'identity-conflict', view: observation('unavailable') },
    ])
      expect(isConnectRigDevicesResult(result)).toBe(true)
  })

  it('preserves completed command evidence independently of the subsequent observation', () => {
    for (const state of ['complete', 'available', 'unavailable'] as const) {
      expect(
        isConnectRigDevicesResult({
          outcome: 'complete',
          command: 'completed',
          confirmedConnected: [device(0)],
          view: observation(state),
        }),
      ).toBe(true)
    }
  })

  it('rejects conflicting variant fields even when they are null', () => {
    const base = {
      outcome: 'uncertain',
      view: observation(),
      confirmedConnected: [],
      notAttempted: [],
      uncertain: { ...device(1), reason: 'write-outcome-unknown' },
    }

    for (const field of ['failed', 'stoppedAfter']) {
      for (const value of [null, undefined, device(0)]) {
        expect(isConnectRigDevicesResult({ ...base, [field]: value })).toBe(false)
      }
    }
  })

  it('rejects malformed and contradictory operation evidence', () => {
    const valid = {
      outcome: 'partial',
      view: observation(),
      confirmedConnected: [device(0)],
      failed: { ...device(1), reason: 'rejected' },
      notAttempted: [device(2)],
    }

    for (const patch of [
      { confirmedConnected: [] },
      { confirmedConnected: [device(0), device(0)] },
      { notAttempted: [device(0)] },
      { failed: { ...device(0), reason: 'rejected' } },
      { failed: { ...device(1), reason: 'made-up' } },
      { failed: undefined, stoppedAfter: device(1) },
      { view: { ...observation(), rig: { id: 'rig-1' } } },
    ])
      expect(isConnectRigDevicesResult({ ...valid, ...patch })).toBe(false)
    expect(
      isConnectRigDevicesResult({
        outcome: 'complete',
        command: 'completed',
        confirmedConnected: [],
        view: observation('complete'),
      }),
    ).toBe(false)
  })
})
