import { describe, expect, it, vi } from 'vitest'
import {
  AlpacaProviderError,
  type AlpacaDeviceInspection,
} from '@vela/alpaca'
import type { RigDeviceInspector } from '../device/inspection.js'
import { createMemoryRigCatalog } from './catalog.js'
import type { RigCatalogRecord } from './contracts.js'
import { loadRigDetailView } from './detail.js'

const endpoint = { host: 'ascom-remote.local', port: 11111 }

const refreshedAt = new Date('2026-09-03T20:00:00.000Z')

function rig(
  id = 'rig-1',
  uniqueId = 'camera-0',
  name = 'Camera slot',
): RigCatalogRecord {
  return {
    id,
    name: 'Backyard rig',
    endpoint,
    addedAt: '2026-09-01T20:00:00.000Z',
    lastObservedInventory: {
      observedAt: '2026-09-02T20:00:00.000Z',
      devices: [{ uniqueId, kind: 'camera', name }],
    },
  }
}

function inspector(
  result: ReadonlyArray<AlpacaDeviceInspection> | Error,
): RigDeviceInspector {
  return {
    async inspectDevices() {
      if (result instanceof Error) throw result

      return result
    },
  }
}

describe('Rig detail projection', () => {
  it('maps current provider observations into Vela status and persists identities only', async () => {
    const catalog = createMemoryRigCatalog([rig()])

    const inspections: ReadonlyArray<AlpacaDeviceInspection> = [
      {
        providerDeviceId: 'camera-0',
        kind: 'camera',
        configuredName: 'Camera slot',
        name: 'ZWO ASI2600MC Pro',
        connection: 'connected',
        telemetry: {
          availability: 'complete',
          values: {
            kind: 'camera',
            activity: 'idle',
            sensorTemperatureC: -5,
            cooling: {
              state: 'off',
              setpointControl: true,
              powerReporting: true,
              powerPercent: 0,
            },
          },
        },
      },
      {
        providerDeviceId: 'telescope-0',
        kind: 'telescope',
        configuredName: 'Mount slot',
        name: 'ASI Mount',
        connection: 'connected',
        telemetry: {
          availability: 'partial',
          values: {
            kind: 'telescope',
            parked: false,
            atHome: false,
            tracking: true,
          },
        },
      },
      {
        providerDeviceId: 'switch-0',
        kind: 'switch',
        configuredName: 'Power slot',
        name: 'Power box',
        connection: 'disconnected',
        telemetry: { availability: 'unavailable' },
      },
    ]

    const result = await loadRigDetailView(catalog, 'rig-1', {
      createInspector: () => inspector(inspections),
      now: () => refreshedAt,
    })

    expect(result).toEqual({
      state: 'found',
      view: {
        id: 'rig-1',
        name: 'Backyard rig',
        state: 'reachable',
        endpoint,
        addedAt: '2026-09-01T20:00:00.000Z',
        lastInventoryAt: '2026-09-03T20:00:00.000Z',
        refreshedAt: '2026-09-03T20:00:00.000Z',
        connections: { total: 3, connected: 2, disconnected: 1, unavailable: 0 },
        devices: [
          {
            id: 'rig-1-camera-0',
            kind: 'camera',
            name: 'ZWO ASI2600MC Pro',
            configuredName: 'Camera slot',
            connection: 'connected',
            observedAt: '2026-09-03T20:00:00.000Z',
            status: {
              availability: 'complete',
              activity: 'idle',
              sensorTemperatureC: -5,
              cooling: { state: 'off', powerPercent: 0 },
            },
          },
          {
            id: 'rig-1-telescope-0',
            kind: 'telescope',
            name: 'ASI Mount',
            configuredName: 'Mount slot',
            connection: 'connected',
            observedAt: '2026-09-03T20:00:00.000Z',
            status: {
              availability: 'partial',
              activity: 'tracking',
              tracking: 'on',
              parking: 'unparked',
              home: 'away',
            },
          },
          {
            id: 'rig-1-switch-0',
            kind: 'switch',
            name: 'Power box',
            configuredName: 'Power slot',
            connection: 'disconnected',
            observedAt: '2026-09-03T20:00:00.000Z',
            status: { availability: 'unavailable' },
          },
        ],
        capabilities: ['forget'],
      },
    })
    await expect(catalog.get('rig-1')).resolves.toMatchObject({
      lastObservedInventory: {
        observedAt: '2026-09-03T20:00:00.000Z',
        devices: [
          { uniqueId: 'camera-0', kind: 'camera', name: 'Camera slot' },
          { uniqueId: 'telescope-0', kind: 'telescope', name: 'Mount slot' },
          { uniqueId: 'switch-0', kind: 'switch', name: 'Power slot' },
        ],
      },
    })
  })

  it.each([
    ['transport', 'offline'],
    ['invalid-response', 'needs-attention'],
    ['protocol-error', 'needs-attention'],
  ] as const)('projects %s inventory failure as %s identity-only state', async (reason, state) => {
    const record = rig()
    const catalog = createMemoryRigCatalog([record])

    const cause = new AlpacaProviderError('Inspection failed', {
      reason,
      endpoint: '/management/v1/configureddevices',
    })

    const onUnavailable = vi.fn()

    const result = await loadRigDetailView(catalog, record.id, {
      createInspector: () => inspector(cause),
      now: () => refreshedAt,
      onUnavailable,
    })

    expect(result).toEqual({
      state: 'found',
      view: {
        id: record.id,
        name: record.name,
        state,
        endpoint,
        addedAt: record.addedAt,
        lastInventoryAt: record.lastObservedInventory.observedAt,
        refreshedAt: '2026-09-03T20:00:00.000Z',
        connections: { total: 1, connected: 0, disconnected: 0, unavailable: 1 },
        devices: [{
          id: 'rig-1-camera-0',
          kind: 'camera',
          name: 'Camera slot',
          configuredName: 'Camera slot',
          connection: 'unavailable',
          status: { availability: 'unavailable' },
        }],
        capabilities: ['forget'],
      },
    })
    expect(onUnavailable).toHaveBeenCalledWith(record, state, cause)
    await expect(catalog.get(record.id)).resolves.toEqual(record)
  })

  it('resolves an explicit device error into Rig attention state', async () => {
    const catalog = createMemoryRigCatalog([rig()])

    const result = await loadRigDetailView(catalog, 'rig-1', {
      createInspector: () => inspector([{
        providerDeviceId: 'camera-0',
        kind: 'camera',
        configuredName: 'Camera slot',
        name: 'Main camera',
        connection: 'connected',
        telemetry: {
          availability: 'complete',
          values: { kind: 'camera', activity: 'error' },
        },
      }]),
      now: () => refreshedAt,
    })

    expect(result).toMatchObject({
      state: 'found',
      view: {
        state: 'needs-attention',
        devices: [{ status: { activity: 'error' } }],
      },
    })
  })

  it('returns not found without inspecting an unknown or forgotten Rig', async () => {
    const catalog = createMemoryRigCatalog([rig()])
    const createInspector = vi.fn()

    await expect(loadRigDetailView(catalog, 'unknown', { createInspector })).resolves.toEqual({
      state: 'not-found',
    })
    await catalog.forget('rig-1')
    await expect(loadRigDetailView(catalog, 'rig-1', { createInspector })).resolves.toEqual({
      state: 'not-found',
    })
    expect(createInspector).not.toHaveBeenCalled()
  })

  it('preserves prior identity and reports attention when current evidence conflicts', async () => {
    const recordA = rig('rig-a', 'camera-a', 'Prior camera')
    const recordB = rig('rig-b', 'camera-b', 'Other camera')
    const catalog = createMemoryRigCatalog([recordA, recordB])
    const onConflict = vi.fn()

    const result = await loadRigDetailView(catalog, recordA.id, {
      createInspector: () => inspector([{
        providerDeviceId: 'camera-b',
        kind: 'camera',
        configuredName: 'Other camera',
        name: 'Other camera',
        connection: 'connected',
        telemetry: {
          availability: 'complete',
          values: { kind: 'camera', activity: 'idle' },
        },
      }]),
      now: () => refreshedAt,
      onConflict,
    })

    expect(result).toMatchObject({
      state: 'found',
      view: {
        id: 'rig-a',
        state: 'needs-attention',
        lastInventoryAt: '2026-09-02T20:00:00.000Z',
        connections: { total: 1, connected: 0, disconnected: 0, unavailable: 1 },
        devices: [{ id: 'rig-a-camera-a', name: 'Prior camera' }],
      },
    })
    expect(onConflict).toHaveBeenCalledWith(recordA)
    await expect(catalog.list()).resolves.toEqual([recordA, recordB])
  })
})
