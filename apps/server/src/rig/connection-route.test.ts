import { request as httpRequest } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { AlpacaProviderError, type AlpacaDeviceInspection } from '@vela/alpaca'
import { buildApp } from '../app.js'
import { createMemoryRigCatalog } from './catalog.js'

const disconnectedCamera: AlpacaDeviceInspection = {
  providerDeviceId: 'camera-0',
  kind: 'camera',
  configuredName: 'Camera slot',
  name: 'Main camera',
  connection: 'disconnected',
  telemetry: { availability: 'unavailable' },
}

const connectedCamera: AlpacaDeviceInspection = {
  ...disconnectedCamera,
  connection: 'connected',
}

const record = {
  id: 'rig-1',
  name: 'Backyard rig',
  endpoint: { host: 'alpaca.test', port: 11111 },
  addedAt: '2026-09-01T20:00:00.000Z',
  lastObservedInventory: {
    observedAt: '2026-09-02T20:00:00.000Z',
    devices: [{ uniqueId: 'camera-0', kind: 'camera' as const, name: 'Camera slot' }],
  },
}

const now = () => new Date('2026-09-04T20:00:00.000Z')

function createInspector(...results: ReadonlyArray<ReadonlyArray<AlpacaDeviceInspection> | Error>) {
  let index = 0

  return () => ({
    async inspectDevices() {
      const result = results[Math.min(index, results.length - 1)]
      index += 1

      if (result instanceof Error) throw result

      return result ?? []
    },
  })
}

describe('Rig connection API', () => {
  it('returns observation connection preparation for known and unknown Rigs', async () => {
    const app = buildApp({
      rigCatalog: createMemoryRigCatalog([record]),
      createInspector: createInspector([disconnectedCamera]),
      now,
    })

    try {
      const known = await app.inject({ method: 'GET', url: '/api/web/rigs/rig-1/observe' })
      expect(known.statusCode).toBe(200)
      expect(known.json()).toMatchObject({
        rig: { id: 'rig-1', connections: { disconnected: 1 } },
        connectionPreparation: {
          state: 'available',
          capabilities: ['connect-devices'],
        },
      })

      const unknown = await app.inject({ method: 'GET', url: '/api/web/rigs/unknown/observe' })
      expect(unknown.statusCode).toBe(404)
      expect(unknown.json()).toEqual({ error: 'rig-not-found' })
    } finally {
      await app.close()
    }
  })

  it('connects through one command and returns a refreshed semantic result', async () => {
    let camera = disconnectedCamera

    const connectDevice = vi.fn(async (_id: string, options?: { readonly signal?: AbortSignal }) => {
      expect(options?.signal).toBeInstanceOf(AbortSignal)
      camera = connectedCamera

      return { outcome: 'connected', command: 'requested' } as const
    })

    const app = buildApp({
      rigCatalog: createMemoryRigCatalog([record]),
      createInspector: () => ({ inspectDevices: async () => [camera] }),
      createConnector: () => ({ connectDevice }),
      now,
    })

    try {
      const response = await app.inject({ method: 'POST', url: '/api/rigs/rig-1/connections' })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({
        outcome: 'complete',
        command: 'completed',
        confirmedConnected: [{ id: 'rig-1-camera-0', kind: 'camera', name: 'Main camera' }],
        view: {
          rig: { id: 'rig-1', connections: { connected: 1, disconnected: 0 } },
          connectionPreparation: { state: 'complete', capabilities: [] },
        },
      })
      expect(connectDevice).toHaveBeenCalledTimes(1)
    } finally {
      await app.close()
    }
  })

  it('returns expected offline and unknown command outcomes without a write', async () => {
    const connectDevice = vi.fn()

    const app = buildApp({
      rigCatalog: createMemoryRigCatalog([record]),
      createInspector: createInspector(new AlpacaProviderError('Private network details', {
        reason: 'transport',
        endpoint: '/management/v1/configureddevices',
      })),
      createConnector: () => ({ connectDevice }),
      now,
    })

    try {
      const offline = await app.inject({ method: 'POST', url: '/api/rigs/rig-1/connections' })
      expect(offline.statusCode).toBe(200)
      expect(offline.json()).toMatchObject({
        outcome: 'unavailable',
        reason: 'offline',
        view: { connectionPreparation: { state: 'unavailable' } },
      })
      expect(JSON.stringify(offline.json())).not.toContain('Private network details')

      const unknown = await app.inject({ method: 'POST', url: '/api/rigs/unknown/connections' })
      expect(unknown.statusCode).toBe(404)
      expect(unknown.json()).toEqual({ error: 'rig-not-found' })
      expect(connectDevice).not.toHaveBeenCalled()
    } finally {
      await app.close()
    }
  })

  it('stops before the next command when the HTTP requester disconnects', async () => {
    const telescope = {
      ...disconnectedCamera,
      providerDeviceId: 'telescope-0',
      kind: 'telescope' as const,
      configuredName: 'Telescope slot',
      name: 'Mount',
    }

    const devices = [disconnectedCamera, telescope]
    const requestSignals: AbortSignal[] = []

    const connectDevice = vi.fn((id: string, options?: { readonly signal?: AbortSignal }) => {
      if (id !== 'camera-0' || options?.signal === undefined) {
        return Promise.resolve({ outcome: 'connected', command: 'requested' } as const)
      }

      requestSignals.push(options.signal)

      return new Promise<{
        readonly outcome: 'uncertain'
        readonly reason: 'cancelled'
      }>((resolve) => {
        options.signal?.addEventListener('abort', () => {
          resolve({ outcome: 'uncertain', reason: 'cancelled' })
        }, { once: true })
      })
    })

    const app = buildApp({
      rigCatalog: createMemoryRigCatalog([{
        ...record,
        lastObservedInventory: {
          ...record.lastObservedInventory,
          devices: [
            ...record.lastObservedInventory.devices,
            { uniqueId: 'telescope-0', kind: 'telescope', name: 'Telescope slot' },
          ],
        },
      }]),
      createInspector: createInspector(devices, devices),
      createConnector: () => ({ connectDevice }),
      now,
    })

    try {
      await app.listen({ host: '127.0.0.1', port: 0 })
      const address = app.server.address()

      if (address === null || typeof address === 'string') throw new Error('Expected TCP server address')

      let connectionRequest: ReturnType<typeof httpRequest> | undefined

      const requestClosed = new Promise<void>((resolve) => {
        connectionRequest = httpRequest({
          host: '127.0.0.1',
          port: address.port,
          method: 'POST',
          path: '/api/rigs/rig-1/connections',
        }, (response) => {
          response.resume()
          response.on('end', resolve)
        })
        connectionRequest.on('error', () => resolve())
        connectionRequest.end()
      })

      await vi.waitFor(() => expect(connectDevice).toHaveBeenCalledTimes(1))
      connectionRequest?.destroy()
      await requestClosed
      await vi.waitFor(() => expect(requestSignals[0]?.aborted).toBe(true))
      await new Promise((resolve) => setImmediate(resolve))

      expect(connectDevice.mock.calls.map(([id]) => id)).toEqual(['camera-0'])
    } finally {
      await app.close()
    }
  })

  it('rejects an overlapping command for the same Rig', async () => {
    let camera = disconnectedCamera
    let finish: (() => void) | undefined

    const connectDevice = vi.fn(() => new Promise<{
      readonly outcome: 'connected'
      readonly command: 'requested'
    }>((resolve) => {
      finish = () => {
        camera = connectedCamera
        resolve({ outcome: 'connected', command: 'requested' })
      }
    }))

    const app = buildApp({
      rigCatalog: createMemoryRigCatalog([record]),
      createInspector: () => ({ inspectDevices: async () => [camera] }),
      createConnector: () => ({ connectDevice }),
      now,
    })

    try {
      const first = app.inject({ method: 'POST', url: '/api/rigs/rig-1/connections' })
      await vi.waitFor(() => expect(connectDevice).toHaveBeenCalledTimes(1))
      const overlap = await app.inject({ method: 'POST', url: '/api/rigs/rig-1/connections' })
      const forget = await app.inject({ method: 'DELETE', url: '/api/rigs/rig-1' })

      expect(overlap.statusCode).toBe(409)
      expect(overlap.json()).toEqual({ error: 'rig-operation-in-progress' })
      expect(forget.statusCode).toBe(409)
      expect(forget.json()).toEqual({ error: 'rig-operation-in-progress' })
      finish?.()
      expect((await first).statusCode).toBe(200)
    } finally {
      await app.close()
    }
  })
})
