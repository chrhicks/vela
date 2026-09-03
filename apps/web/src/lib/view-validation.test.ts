import { describe, expect, it } from 'vitest'
import { isHomeView, isRigDetailView } from './view-validation'

const observedAt = '2026-09-03T20:00:00.000Z'

function detail() {
  return {
    id: 'rig-1',
    name: 'Backyard rig',
    state: 'reachable',
    endpoint: { host: 'alpaca.local', port: 11111 },
    addedAt: observedAt,
    lastInventoryAt: observedAt,
    refreshedAt: observedAt,
    connections: { total: 2, connected: 1, disconnected: 1, unavailable: 0 },
    devices: [
      {
        id: 'rig-1-camera-0',
        kind: 'camera',
        name: 'Main camera',
        configuredName: 'Camera slot',
        connection: 'connected',
        observedAt,
        status: {
          availability: 'partial',
          activity: 'idle',
          sensorTemperatureC: -5,
          cooling: { state: 'on', powerPercent: 42 },
        },
      },
      {
        id: 'rig-1-telescope-0',
        kind: 'telescope',
        name: 'Mount',
        configuredName: 'Mount',
        connection: 'disconnected',
        observedAt,
        status: { availability: 'unavailable' },
      },
    ],
    capabilities: ['forget'],
  }
}

describe('web View validation', () => {
  it('accepts the compact Home projection', () => {
    expect(isHomeView({
      rigs: [{
        id: 'rig-1',
        name: 'Backyard rig',
        reachability: 'reachable',
        lastSeenAt: observedAt,
        connections: { total: 2, connected: 1, disconnected: 1, unavailable: 0 },
        capabilities: ['forget'],
      }],
      refreshedAt: observedAt,
    })).toBe(true)
  })

  it('accepts representative partial and disconnected Rig detail', () => {
    expect(isRigDetailView(detail())).toBe(true)
  })

  it('rejects contradictory device observations and invalid numeric values', () => {
    const contradictory = detail()
    contradictory.devices[0]!.connection = 'disconnected'
    expect(isRigDetailView(contradictory)).toBe(false)

    const invalidPercentage = detail()
    invalidPercentage.devices[0]!.status.cooling!.powerPercent = 101
    expect(isRigDetailView(invalidPercentage)).toBe(false)
  })

  it('rejects contradictory reachability and connection summaries', () => {
    const inconsistent = detail()
    inconsistent.connections = { total: 2, connected: 0, disconnected: 2, unavailable: 0 }
    expect(isRigDetailView(inconsistent)).toBe(false)

    const offlineWithLiveDevices = detail()
    offlineWithLiveDevices.state = 'offline'
    expect(isRigDetailView(offlineWithLiveDevices)).toBe(false)

    expect(isHomeView({
      rigs: [{
        id: 'rig-1',
        name: 'Offline rig',
        reachability: 'unreachable',
        lastSeenAt: observedAt,
        connections: { total: 1, connected: 1, disconnected: 0, unavailable: 0 },
        capabilities: ['forget'],
      }],
      refreshedAt: observedAt,
    })).toBe(false)
  })

  it('rejects duplicate identities and malformed dates', () => {
    const duplicateDevices = detail()
    duplicateDevices.devices.push({ ...duplicateDevices.devices[0]! })
    duplicateDevices.connections = { total: 3, connected: 2, disconnected: 1, unavailable: 0 }
    expect(isRigDetailView(duplicateDevices)).toBe(false)

    const validHomeRig = {
      id: 'rig-1',
      name: 'Backyard rig',
      reachability: 'reachable',
      lastSeenAt: observedAt,
      connections: { total: 0, connected: 0, disconnected: 0, unavailable: 0 },
      capabilities: ['forget'],
    }
    expect(isHomeView({
      rigs: [validHomeRig, { ...validHomeRig }],
      refreshedAt: observedAt,
    })).toBe(false)

    expect(isRigDetailView({
      ...detail(),
      connections: { total: 1, connected: 1, disconnected: 0, unavailable: 0 },
      devices: [{
        id: 'switch-0',
        kind: 'switch',
        name: 'Switch',
        configuredName: 'Switch',
        connection: 'connected',
        observedAt,
        status: {
          availability: 'complete',
          activity: 'reporting',
          channels: [
            { id: 0, name: 'One', value: 1 },
            { id: 0, name: 'Duplicate', value: 2 },
          ],
        },
      }],
    })).toBe(false)

    expect(isHomeView({ rigs: [], refreshedAt: 'yesterday' })).toBe(false)
  })
})
