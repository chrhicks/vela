import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AlpacaDiscoveryError,
  AlpacaProviderError,
  type AlpacaDiscovery,
  type AlpacaEndpoint,
  type AlpacaInspection,
} from '@vela/alpaca'
import { buildApp } from '../app.js'
import { createMemoryRigCatalog } from './catalog.js'
import { discoverRigs, parseDiscoverRigsInput } from './discovery.js'

const endpointA: AlpacaEndpoint = { host: '192.168.4.104', port: 11111 }

const endpointB: AlpacaEndpoint = { host: 'ascom-remote.local', port: 11111 }

const endpointC: AlpacaEndpoint = { host: '192.168.4.120', port: 32323 }

function inspection(
  endpoint: AlpacaEndpoint,
  devices: AlpacaInspection['devices'],
): AlpacaInspection {
  return {
    endpoint,
    apiVersions: [1],
    server: endpoint === endpointA ? { name: 'ASCOM Remote' } : {},
    devices,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('discoverRigs', () => {
  it('inspects scanned endpoints serially and returns candidates with partial failures', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-26T20:00:00.000Z'))

    const providerError = new AlpacaProviderError('Unable to inspect endpoint', {
      reason: 'transport',
      endpoint: '/management/apiversions',
    })

    const inspected: AlpacaEndpoint[] = []
    let activeInspections = 0
    let maximumActiveInspections = 0

    const alpaca: AlpacaDiscovery = {
      async scan() {
        return [endpointA, endpointB, endpointC]
      },
      async inspect(endpoint) {
        inspected.push(endpoint)
        activeInspections += 1
        maximumActiveInspections = Math.max(maximumActiveInspections, activeInspections)
        await Promise.resolve()
        activeInspections -= 1

        if (endpoint === endpointB) throw providerError

        if (endpoint === endpointC) {
          return inspection(endpoint, [{ kind: 'switch', name: 'Legacy Switch' }])
        }

        return inspection(endpoint, [
          {
            providerDeviceId: 'camera-1',
            kind: 'camera',
            name: 'Main Camera',
          },
        ])
      },
    }

    const result = await discoverRigs({ mode: 'scan' }, { alpaca })

    expect(inspected).toEqual([endpointA, endpointB, endpointC])
    expect(maximumActiveInspections).toBe(1)
    expect(result).toEqual({
      candidates: [
        {
          endpoint: endpointA,
          server: { name: 'ASCOM Remote' },
          inspectedAt: '2026-08-26T20:00:00.000Z',
          devices: [{ kind: 'camera', name: 'Main Camera' }],
          disposition: { state: 'new' },
        },
        {
          endpoint: endpointC,
          inspectedAt: '2026-08-26T20:00:00.000Z',
          devices: [{ kind: 'switch', name: 'Legacy Switch' }],
          disposition: {
            state: 'ineligible',
            reason: 'no-stable-device-id',
          },
        },
      ],
      failures: [
        {
          view: { endpoint: endpointB, reason: 'unreachable' },
          cause: providerError,
        },
      ],
    })
  })

  it('marks a known Rig and updates its changed endpoint from stable device evidence', async () => {
    const catalog = createMemoryRigCatalog([
      {
        id: 'rig-1',
        name: 'Backyard rig',
        endpoint: endpointB,
        addedAt: '2026-09-01T20:00:00.000Z',
        lastObservedInventory: {
          observedAt: '2026-09-01T20:00:00.000Z',
          devices: [{ uniqueId: 'camera-1', kind: 'camera', name: 'Old camera name' }],
        },
      },
    ])

    const alpaca: AlpacaDiscovery = {
      async scan() {
        return [endpointA]
      },
      async inspect() {
        return inspection(endpointA, [
          {
            providerDeviceId: 'camera-1',
            kind: 'camera',
            name: 'Main Camera',
          },
        ])
      },
    }

    const result = await discoverRigs(
      { mode: 'scan' },
      {
        alpaca,
        catalog,
        now: () => new Date('2026-09-02T20:00:00.000Z'),
      },
    )

    expect(result.candidates[0]?.disposition).toEqual({
      state: 'already-added',
      rigId: 'rig-1',
    })
    await expect(catalog.list()).resolves.toEqual([
      {
        id: 'rig-1',
        name: 'Backyard rig',
        endpoint: endpointA,
        addedAt: '2026-09-01T20:00:00.000Z',
        lastObservedInventory: {
          observedAt: '2026-09-02T20:00:00.000Z',
          devices: [{ uniqueId: 'camera-1', kind: 'camera', name: 'Main Camera' }],
        },
      },
    ])
  })

  it('turns a known UDP scan failure into a sanitized failure while retaining its cause', async () => {
    const scanError = new AlpacaDiscoveryError('Every interface failed')

    const alpaca: AlpacaDiscovery = {
      async scan() {
        throw scanError
      },
      async inspect() {
        throw new Error('inspect should not run')
      },
    }

    await expect(discoverRigs({ mode: 'scan' }, { alpaca })).resolves.toEqual({
      candidates: [],
      failures: [{ view: { reason: 'scan-failed' }, cause: scanError }],
    })
  })

  it('propagates caller cancellation', async () => {
    const controller = new AbortController()
    const cancellation = new Error('request disconnected')

    const alpaca: AlpacaDiscovery = {
      scan({ signal } = {}) {
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      },
      async inspect() {
        throw new Error('inspect should not run')
      },
    }

    const discovery = discoverRigs({ mode: 'scan' }, { alpaca, signal: controller.signal })

    const rejection = expect(discovery).rejects.toBe(cancellation)
    controller.abort(cancellation)

    await rejection
  })
})

describe('discovery input', () => {
  it('normalizes valid manual input and its default port', () => {
    expect(
      parseDiscoverRigsInput({
        mode: 'manual',
        host: 'ascom-remote.local',
      }),
    ).toEqual({ mode: 'manual', endpoint: endpointB })

    expect(
      parseDiscoverRigsInput({
        mode: 'manual',
        host: '192.168.4.120',
        port: 32323,
      }),
    ).toEqual({ mode: 'manual', endpoint: endpointC })
  })

  it.each([
    undefined,
    {},
    { mode: 'scan', host: 'unexpected' },
    { mode: 'manual', host: 'http://ascom-remote.local' },
    { mode: 'manual', host: 'ascom-remote.local/path' },
    { mode: 'manual', host: 'ascom-remote.local:11111' },
    { mode: 'manual', host: ' ascom-remote.local' },
    { mode: 'manual', host: '999.999.999.999' },
    { mode: 'manual', host: 'ascom-remote.local', port: 0 },
  ])('rejects invalid input %#', input => {
    expect(parseDiscoverRigsInput(input)).toBeUndefined()
  })
})

describe('POST /api/rigs/discovery', () => {
  it('uses manual inspection without scanning and removes error causes from the response', async () => {
    const providerError = new AlpacaProviderError('Private transport details', {
      reason: 'transport',
      endpoint: '/management/apiversions',
      cause: new Error('socket details'),
    })

    const alpaca: AlpacaDiscovery = {
      async scan() {
        throw new Error('scan should not run')
      },
      async inspect(endpoint) {
        expect(endpoint).toEqual(endpointB)
        throw providerError
      },
    }

    const app = buildApp({ alpacaDiscovery: alpaca })

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/rigs/discovery',
        payload: { mode: 'manual', host: 'ascom-remote.local' },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({
        candidates: [],
        failures: [{ endpoint: endpointB, reason: 'unreachable' }],
      })
    } finally {
      await app.close()
    }
  })

  it('rejects invalid request input before touching Alpaca', async () => {
    const scan = vi.fn<AlpacaDiscovery['scan']>()
    const inspect = vi.fn<AlpacaDiscovery['inspect']>()
    const app = buildApp({ alpacaDiscovery: { scan, inspect } })

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/rigs/discovery',
        payload: { mode: 'manual', host: 'http://not-a-host' },
      })

      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ error: 'invalid-discovery-request' })
      expect(scan).not.toHaveBeenCalled()
      expect(inspect).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })
})
