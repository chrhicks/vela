import { describe, expect, it, vi } from 'vitest'
import {
  AlpacaProviderError,
  type AlpacaDeviceConnectionResult,
  type AlpacaDeviceInspection,
} from '@vela/alpaca'
import type { DeviceKind } from '@vela/model/device'
import type { RigDeviceConnector } from '../device/connection.js'
import type { RigDeviceInspector } from '../device/inspection.js'
import { createMemoryRigCatalog } from './catalog.js'
import { createRigConnectionCoordinator } from './connection.js'
import type { RigCatalogRecord } from './contracts.js'

const endpoint = { host: 'alpaca.test', port: 11111 }

const now = () => new Date('2026-09-04T20:00:00.000Z')

function inspection(
  providerDeviceId: string,
  kind: DeviceKind,
  connection: 'connected' | 'disconnected' | 'unavailable',
): AlpacaDeviceInspection {
  return {
    providerDeviceId,
    kind,
    configuredName: `${providerDeviceId} slot`,
    name: `${providerDeviceId} hardware`,
    connection,
    telemetry: { availability: 'unavailable' },
  }
}

function record(
  id: string,
  devices: ReadonlyArray<AlpacaDeviceInspection>,
  rigEndpoint = endpoint,
): RigCatalogRecord {
  return {
    id,
    name: `${id} name`,
    endpoint: rigEndpoint,
    addedAt: '2026-09-01T20:00:00.000Z',
    lastObservedInventory: {
      observedAt: '2026-09-02T20:00:00.000Z',
      devices: devices.map((device) => ({
        uniqueId: device.providerDeviceId,
        kind: device.kind,
        name: device.configuredName,
      })),
    },
  }
}

function inspectorSequence(
  ...results: ReadonlyArray<ReadonlyArray<AlpacaDeviceInspection> | Error>
) {
  let index = 0

  const inspectDevices = vi.fn(async () => {
    const result = results[Math.min(index, results.length - 1)]
    index += 1

    if (result instanceof Error) throw result

    return result ?? []
  })

  return {
    createInspector: () => ({ inspectDevices }) satisfies RigDeviceInspector,
    inspectDevices,
  }
}

function connector(
  operation: (providerDeviceId: string, signal?: AbortSignal) => Promise<AlpacaDeviceConnectionResult>,
) {
  const connectDevice = vi.fn((providerDeviceId: string, options?: { readonly signal?: AbortSignal }) =>
    operation(providerDeviceId, options?.signal))

  return {
    createConnector: () => ({ connectDevice }) satisfies RigDeviceConnector,
    connectDevice,
  }
}

const connected = { outcome: 'connected', command: 'requested' } as const

describe('Rig device connection coordinator', () => {
  it('returns unknown without inspecting or connecting devices', async () => {
    const inspector = inspectorSequence([])
    const deviceConnector = connector(async () => connected)

    const coordinator = createRigConnectionCoordinator({
      catalog: createMemoryRigCatalog(),
      createInspector: inspector.createInspector,
      createConnector: deviceConnector.createConnector,
      now,
    })

    await expect(coordinator.connectDevices('unknown')).resolves.toEqual({ state: 'not-found' })
    expect(inspector.inspectDevices).not.toHaveBeenCalled()
    expect(deviceConnector.connectDevice).not.toHaveBeenCalled()
  })

  it('does not write when the Rig is offline or current identity conflicts', async () => {
    const camera = inspection('camera-0', 'camera', 'disconnected')

    const offlineInspector = inspectorSequence(new AlpacaProviderError('Offline', {
      reason: 'transport',
      endpoint: '/management/v1/configureddevices',
    }))

    const deviceConnector = connector(async () => connected)

    const offlineCoordinator = createRigConnectionCoordinator({
      catalog: createMemoryRigCatalog([record('rig-1', [camera])]),
      createInspector: offlineInspector.createInspector,
      createConnector: deviceConnector.createConnector,
      now,
    })

    await expect(offlineCoordinator.connectDevices('rig-1')).resolves.toMatchObject({
      state: 'finished',
      result: {
        outcome: 'unavailable',
        reason: 'offline',
        view: { connectionPreparation: { state: 'unavailable' } },
      },
    })

    const conflictInspector = inspectorSequence([camera])

    const conflictCoordinator = createRigConnectionCoordinator({
      catalog: createMemoryRigCatalog([
        record('rig-a', [camera]),
        record('rig-b', [inspection('camera-b', 'camera', 'connected')]),
      ]),
      createInspector: conflictInspector.createInspector,
      createConnector: deviceConnector.createConnector,
      now,
    })

    await expect(conflictCoordinator.connectDevices('rig-a')).resolves.toMatchObject({
      state: 'finished',
      result: { outcome: 'unavailable', reason: 'identity-conflict' },
    })
    expect(deviceConnector.connectDevice).not.toHaveBeenCalled()
  })

  it('does not write when supported device state is unavailable', async () => {
    const camera = inspection('camera-0', 'camera', 'unavailable')
    const inspector = inspectorSequence([camera])
    const deviceConnector = connector(async () => connected)

    const coordinator = createRigConnectionCoordinator({
      catalog: createMemoryRigCatalog([record('rig-1', [camera])]),
      createInspector: inspector.createInspector,
      createConnector: deviceConnector.createConnector,
      now,
    })

    await expect(coordinator.connectDevices('rig-1')).resolves.toMatchObject({
      state: 'finished',
      result: { outcome: 'unavailable', reason: 'device-state-unavailable' },
    })
    expect(deviceConnector.connectDevice).not.toHaveBeenCalled()
  })

  it('treats connected supported devices as complete and ignores unsupported kinds', async () => {
    const devices = [
      inspection('camera-0', 'camera', 'connected'),
      inspection('dome-0', 'dome', 'disconnected'),
      inspection('unknown-0', 'unknown', 'disconnected'),
    ]

    const inspector = inspectorSequence(devices)
    const deviceConnector = connector(async () => connected)

    const coordinator = createRigConnectionCoordinator({
      catalog: createMemoryRigCatalog([record('rig-1', devices)]),
      createInspector: inspector.createInspector,
      createConnector: deviceConnector.createConnector,
      now,
    })

    await expect(coordinator.connectDevices('rig-1')).resolves.toMatchObject({
      state: 'finished',
      result: {
        outcome: 'complete',
        command: 'not-needed',
        confirmedConnected: [],
        view: { connectionPreparation: { state: 'complete' } },
      },
    })
    expect(deviceConnector.connectDevice).not.toHaveBeenCalled()
  })

  it('connects only disconnected supported devices in provider order', async () => {
    const initial = [
      inspection('camera-0', 'camera', 'disconnected'),
      inspection('telescope-0', 'telescope', 'connected'),
      inspection('dome-0', 'dome', 'disconnected'),
      inspection('switch-0', 'switch', 'disconnected'),
    ]

    let devices = initial
    const createInspector = () => ({ inspectDevices: async () => devices })

    const deviceConnector = connector(async (id) => {
      devices = devices.map((device) => device.providerDeviceId === id
        ? { ...device, connection: 'connected' as const }
        : device)

      return connected
    })

    const coordinator = createRigConnectionCoordinator({
      catalog: createMemoryRigCatalog([record('rig-1', initial)]),
      createInspector,
      createConnector: deviceConnector.createConnector,
      now,
    })

    await expect(coordinator.connectDevices('rig-1')).resolves.toMatchObject({
      state: 'finished',
      result: {
        outcome: 'complete',
        command: 'completed',
        confirmedConnected: [
          { id: 'rig-1-camera-0', kind: 'camera', name: 'camera-0 hardware' },
          { id: 'rig-1-switch-0', kind: 'switch', name: 'switch-0 hardware' },
        ],
        view: { connectionPreparation: { state: 'complete' } },
      },
    })
    expect(deviceConnector.connectDevice.mock.calls.map(([id]) => id)).toEqual([
      'camera-0',
      'switch-0',
    ])
  })

  it('stops on confirmed failure and preserves prior success', async () => {
    const initial = [
      inspection('camera-0', 'camera', 'disconnected'),
      inspection('telescope-0', 'telescope', 'disconnected'),
      inspection('switch-0', 'switch', 'disconnected'),
    ]

    const afterFailure = [
      { ...initial[0]!, connection: 'connected' as const },
      initial[1]!,
      initial[2]!,
    ]

    const inspector = inspectorSequence(initial, afterFailure)

    const deviceConnector = connector(async (id) => id === 'camera-0'
      ? connected
      : { outcome: 'failed', reason: 'rejected' })

    const coordinator = createRigConnectionCoordinator({
      catalog: createMemoryRigCatalog([record('rig-1', initial)]),
      createInspector: inspector.createInspector,
      createConnector: deviceConnector.createConnector,
      now,
    })

    await expect(coordinator.connectDevices('rig-1')).resolves.toMatchObject({
      state: 'finished',
      result: {
        outcome: 'partial',
        confirmedConnected: [{ id: 'rig-1-camera-0' }],
        failed: { id: 'rig-1-telescope-0', reason: 'rejected' },
        notAttempted: [{ id: 'rig-1-switch-0' }],
        view: {
          rig: { connections: { connected: 1, disconnected: 2 } },
          connectionPreparation: { state: 'available' },
        },
      },
    })
    expect(deviceConnector.connectDevice.mock.calls.map(([id]) => id)).toEqual([
      'camera-0',
      'telescope-0',
    ])
  })

  it('reports first-device rejection as failed rather than partial', async () => {
    const devices = [inspection('camera-0', 'camera', 'disconnected')]
    const inspector = inspectorSequence(devices, devices)
    const deviceConnector = connector(async () => ({ outcome: 'failed', reason: 'remained-disconnected' }))

    const coordinator = createRigConnectionCoordinator({
      catalog: createMemoryRigCatalog([record('rig-1', devices)]),
      createInspector: inspector.createInspector,
      createConnector: deviceConnector.createConnector,
      now,
    })

    await expect(coordinator.connectDevices('rig-1')).resolves.toMatchObject({
      state: 'finished',
      result: {
        outcome: 'failed',
        confirmedConnected: [],
        failed: { id: 'rig-1-camera-0', reason: 'remained-disconnected' },
      },
    })
  })

  it('stops after uncertainty and reports only confirmed facts', async () => {
    const initial = [
      inspection('camera-0', 'camera', 'disconnected'),
      inspection('telescope-0', 'telescope', 'disconnected'),
      inspection('switch-0', 'switch', 'disconnected'),
    ]

    const refreshed = [
      { ...initial[0]!, connection: 'connected' as const },
      { ...initial[1]!, connection: 'unavailable' as const },
      initial[2]!,
    ]

    const inspector = inspectorSequence(initial, refreshed)

    const deviceConnector = connector(async (id) => id === 'camera-0'
      ? connected
      : { outcome: 'uncertain', reason: 'write-outcome-unknown' })

    const coordinator = createRigConnectionCoordinator({
      catalog: createMemoryRigCatalog([record('rig-1', initial)]),
      createInspector: inspector.createInspector,
      createConnector: deviceConnector.createConnector,
      now,
    })

    await expect(coordinator.connectDevices('rig-1')).resolves.toMatchObject({
      state: 'finished',
      result: {
        outcome: 'uncertain',
        confirmedConnected: [{ id: 'rig-1-camera-0' }],
        uncertain: { id: 'rig-1-telescope-0', reason: 'write-outcome-unknown' },
        notAttempted: [{ id: 'rig-1-switch-0' }],
      },
    })
    expect(deviceConnector.connectDevice.mock.calls.map(([id]) => id)).toEqual([
      'camera-0',
      'telescope-0',
    ])
  })

  it('uses refreshed connection evidence to resolve an initially uncertain device', async () => {
    const initial = [
      inspection('camera-0', 'camera', 'disconnected'),
      inspection('telescope-0', 'telescope', 'disconnected'),
    ]

    const refreshed = [
      { ...initial[0]!, connection: 'connected' as const },
      initial[1]!,
    ]

    const inspector = inspectorSequence(initial, refreshed)

    const deviceConnector = connector(async () => ({
      outcome: 'uncertain',
      reason: 'verification-unavailable',
    }))

    const coordinator = createRigConnectionCoordinator({
      catalog: createMemoryRigCatalog([record('rig-1', initial)]),
      createInspector: inspector.createInspector,
      createConnector: deviceConnector.createConnector,
      now,
    })

    await expect(coordinator.connectDevices('rig-1')).resolves.toMatchObject({
      state: 'finished',
      result: {
        outcome: 'partial',
        confirmedConnected: [{ id: 'rig-1-camera-0' }],
        stoppedAfter: { id: 'rig-1-camera-0' },
        notAttempted: [{ id: 'rig-1-telescope-0' }],
        view: { connectionPreparation: { state: 'available' } },
      },
    })
    expect(deviceConnector.connectDevice.mock.calls.map(([id]) => id)).toEqual(['camera-0'])
  })

  it('turns uncertainty into confirmed failure when refreshed state is disconnected', async () => {
    const devices = [inspection('camera-0', 'camera', 'disconnected')]
    const inspector = inspectorSequence(devices, devices)

    const deviceConnector = connector(async () => ({
      outcome: 'uncertain',
      reason: 'verification-timeout',
    }))

    const coordinator = createRigConnectionCoordinator({
      catalog: createMemoryRigCatalog([record('rig-1', devices)]),
      createInspector: inspector.createInspector,
      createConnector: deviceConnector.createConnector,
      now,
    })

    await expect(coordinator.connectDevices('rig-1')).resolves.toMatchObject({
      state: 'finished',
      result: {
        outcome: 'failed',
        confirmedConnected: [],
        failed: { id: 'rig-1-camera-0', reason: 'remained-disconnected' },
      },
    })
  })

  it('stops further sequencing when the requester cancels and releases the Rig', async () => {
    const disconnected = [
      inspection('camera-0', 'camera', 'disconnected'),
      inspection('telescope-0', 'telescope', 'disconnected'),
    ]

    let devices = disconnected
    const createInspector = () => ({ inspectDevices: async () => devices })
    const controller = new AbortController()
    const calls: string[] = []

    const deviceConnector = connector(async (id) => {
      calls.push(id)
      devices = devices.map((device) => device.providerDeviceId === id
        ? { ...device, connection: 'connected' as const }
        : device)

      if (id === 'camera-0') controller.abort(new DOMException('Cancelled', 'AbortError'))

      return connected
    })

    const coordinator = createRigConnectionCoordinator({
      catalog: createMemoryRigCatalog([record('rig-1', disconnected)]),
      createInspector,
      createConnector: deviceConnector.createConnector,
      now,
    })

    await expect(coordinator.connectDevices('rig-1', { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(calls).toEqual(['camera-0'])

    await expect(coordinator.connectDevices('rig-1')).resolves.toMatchObject({
      state: 'finished',
      result: { outcome: 'complete', confirmedConnected: [{ id: 'rig-1-telescope-0' }] },
    })
    expect(calls).toEqual(['camera-0', 'telescope-0'])
  })

  it('rejects same-Rig overlap and exposes active progress through the observation View', async () => {
    const initial = [inspection('camera-0', 'camera', 'disconnected')]
    const final = [{ ...initial[0]!, connection: 'connected' as const }]
    let devices = initial
    const createInspector = () => ({ inspectDevices: async () => devices })
    let finishConnection: ((value: AlpacaDeviceConnectionResult) => void) | undefined

    const deviceConnector = connector(() => new Promise((resolve) => {
      finishConnection = (result) => {
        devices = final
        resolve(result)
      }
    }))

    const coordinator = createRigConnectionCoordinator({
      catalog: createMemoryRigCatalog([record('rig-1', initial)]),
      createInspector,
      createConnector: deviceConnector.createConnector,
      now,
    })

    const operation = coordinator.connectDevices('rig-1')
    await vi.waitFor(() => expect(deviceConnector.connectDevice).toHaveBeenCalledTimes(1))

    await expect(coordinator.connectDevices('rig-1')).resolves.toEqual({ state: 'in-progress' })
    await expect(coordinator.loadObservation('rig-1')).resolves.toMatchObject({
      state: 'found',
      view: { connectionPreparation: { state: 'in-progress', capabilities: [] } },
    })

    await expect(coordinator.loadObservation('rig-1')).resolves.toMatchObject({
      state: 'found',
      view: { rig: { connections: { disconnected: 1, connected: 0 } } },
    })

    finishConnection?.(connected)
    await expect(operation).resolves.toMatchObject({
      state: 'finished',
      result: {
        outcome: 'complete',
        view: { rig: { connections: { disconnected: 0, connected: 1 } } },
      },
    })
  })

  it('prevents Forget Rig from racing an active connection operation', async () => {
    const initial = [inspection('camera-0', 'camera', 'disconnected')]
    const final = [{ ...initial[0]!, connection: 'connected' as const }]
    const catalog = createMemoryRigCatalog([record('rig-1', initial)])
    let devices = initial
    const createInspector = () => ({ inspectDevices: async () => devices })
    let finishConnection: ((value: AlpacaDeviceConnectionResult) => void) | undefined

    const deviceConnector = connector(() => new Promise((resolve) => {
      finishConnection = (result) => {
        devices = final
        resolve(result)
      }
    }))

    const coordinator = createRigConnectionCoordinator({
      catalog,
      createInspector,
      createConnector: deviceConnector.createConnector,
      now,
    })

    const operation = coordinator.connectDevices('rig-1')
    await vi.waitFor(() => expect(deviceConnector.connectDevice).toHaveBeenCalledTimes(1))
    await expect(coordinator.forgetRig('rig-1')).resolves.toEqual({ state: 'in-progress' })
    expect(await catalog.get('rig-1')).toBeDefined()

    finishConnection?.(connected)
    await expect(operation).resolves.toMatchObject({ state: 'finished' })
    await expect(coordinator.forgetRig('rig-1')).resolves.toEqual({ state: 'forgotten' })
    expect(await catalog.get('rig-1')).toBeUndefined()
  })

  it('allows different Rigs to connect independently', async () => {
    const firstCamera = inspection('camera-a', 'camera', 'disconnected')
    const secondCamera = inspection('camera-b', 'camera', 'disconnected')
    const connectionState = new Map([['rig-a', false], ['rig-b', false]])
    let finishFirst: (() => void) | undefined

    const createConnector = vi.fn((rig: { readonly id: string }) => ({
      async connectDevice() {
        if (rig.id === 'rig-a') {
          await new Promise<void>((resolve) => {
            finishFirst = () => {
              connectionState.set(rig.id, true)
              resolve()
            }
          })
        } else {
          connectionState.set(rig.id, true)
        }

        return connected
      },
    }))

    const coordinator = createRigConnectionCoordinator({
      catalog: createMemoryRigCatalog([
        record('rig-a', [firstCamera], { host: 'first.test', port: 11111 }),
        record('rig-b', [secondCamera], { host: 'second.test', port: 11111 }),
      ]),
      createInspector: (rig) => ({
        async inspectDevices() {
          const source = rig.id === 'rig-a' ? firstCamera : secondCamera

          return [{
            ...source,
            connection: connectionState.get(rig.id) ? 'connected' as const : 'disconnected' as const,
          }]
        },
      }),
      createConnector,
      now,
    })

    const first = coordinator.connectDevices('rig-a')
    await vi.waitFor(() => expect(finishFirst).toBeTypeOf('function'))
    await expect(coordinator.connectDevices('rig-b')).resolves.toMatchObject({
      state: 'finished',
      result: { outcome: 'complete', confirmedConnected: [{ id: 'rig-b-camera-b' }] },
    })

    finishFirst?.()
    await expect(first).resolves.toMatchObject({
      state: 'finished',
      result: { outcome: 'complete', confirmedConnected: [{ id: 'rig-a-camera-a' }] },
    })
  })

  it('maps a pre-write provider failure without exposing protocol details', async () => {
    const devices = [inspection('camera-0', 'camera', 'disconnected')]
    const inspector = inspectorSequence(devices, devices)

    const cause = new AlpacaProviderError('Private endpoint details', {
      reason: 'transport',
      endpoint: '/management/v1/configureddevices',
    })

    const deviceConnector = connector(async () => { throw cause })
    const onProviderResult = vi.fn()

    const coordinator = createRigConnectionCoordinator({
      catalog: createMemoryRigCatalog([record('rig-1', devices)]),
      createInspector: inspector.createInspector,
      createConnector: deviceConnector.createConnector,
      now,
    })

    const operation = await coordinator.connectDevices('rig-1', { onProviderResult })

    expect(operation).toMatchObject({
      state: 'finished',
      result: {
        outcome: 'failed',
        failed: { reason: 'connection-check-failed' },
      },
    })
    expect(JSON.stringify(operation)).not.toContain('Private endpoint details')
    expect(JSON.stringify(operation)).not.toContain('/management/v1/configureddevices')
    expect(onProviderResult).toHaveBeenCalledWith('camera-0', cause)
  })
})
