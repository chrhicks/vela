import type { ResponseFixture } from './internal/test-fixtures.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAlpacaDiscovery, type AlpacaEndpoint, type AlpacaUdpScanner } from './index.js'

type RouteResult = ResponseFixture | Error

function envelope(Value: ResponseFixture, ErrorNumber = 0, ErrorMessage = '') {
  return {
    Value,
    ClientTransactionID: 0,
    ServerTransactionID: 1,
    ErrorNumber,
    ErrorMessage,
  }
}

function fakeFetch(
  routes: Record<string, RouteResult>,
  requests: string[] = [],
): typeof globalThis.fetch {
  return async input => {
    const url = new URL(String(input))
    requests.push(url.pathname)
    const result = routes[url.pathname]

    if (result instanceof Error) throw result

    if (result === undefined) return new Response('Not found', { status: 404 })

    return Response.json(result)
  }
}

function deferred() {
  let resolve!: () => void

  const promise = new Promise<void>(resolvePromise => {
    resolve = resolvePromise
  })

  return { promise, resolve }
}

const endpoint: AlpacaEndpoint = { host: '192.168.4.104', port: 11111 }

afterEach(() => {
  vi.useRealTimers()
})

describe('createAlpacaDiscovery', () => {
  it('uses scan defaults while allowing explicit options', async () => {
    const scan = vi.fn(async () => [endpoint])
    const udpScanner: AlpacaUdpScanner = { scan }
    const discovery = createAlpacaDiscovery({ udpScanner })
    const controller = new AbortController()

    await expect(discovery.scan()).resolves.toEqual([endpoint])
    expect(scan).toHaveBeenNthCalledWith(1, {
      durationMs: 1_000,
      attempts: 2,
    })

    await discovery.scan({
      durationMs: 2_000,
      attempts: 3,
      signal: controller.signal,
      interfaceAddresses: ['192.168.4.2'],
    })
    expect(scan).toHaveBeenNthCalledWith(2, {
      durationMs: 2_000,
      attempts: 3,
      signal: controller.signal,
      interfaceAddresses: ['192.168.4.2'],
    })
  })

  it('inspects Management API endpoints serially and normalizes the result', async () => {
    const requests: string[] = []

    const fixtureFetch = fakeFetch(
      {
        '/management/apiversions': envelope([1]),
        '/management/v1/description': envelope({
          ServerName: 'ASCOM Remote Server',
          Manufacturer: 'ASCOM Initiative',
          ManufacturerVersion: '7.0',
          Location: 'Observatory',
        }),
        '/management/v1/configureddevices': envelope([
          {
            DeviceName: ' Main Camera ',
            DeviceType: 'Camera',
            DeviceNumber: 0,
            UniqueID: ' camera-1 ',
          },
          {
            DeviceName: ' Legacy Device ',
            DeviceType: 'Video',
            DeviceNumber: 1,
          },
        ]),
      },
      requests,
    )

    const stages = Array.from({ length: 3 }, () => ({
      started: deferred(),
      release: deferred(),
    }))

    let stageIndex = 0

    const discovery = createAlpacaDiscovery({
      fetch: async (input, init) => {
        const stage = stages[stageIndex++]!
        const response = await fixtureFetch(input, init)
        stage.started.resolve()
        await stage.release.promise

        return response
      },
    })

    const inspection = discovery.inspect(endpoint)

    try {
      for (let index = 0; index < stages.length; index += 1) {
        await stages[index]!.started.promise
        expect(requests).toHaveLength(index + 1)
        stages[index]!.release.resolve()
      }
    } finally {
      for (const stage of stages) stage.release.resolve()
    }

    await expect(inspection).resolves.toEqual({
      endpoint,
      apiVersions: [1],
      server: {
        name: 'ASCOM Remote Server',
        manufacturer: 'ASCOM Initiative',
        manufacturerVersion: '7.0',
        location: 'Observatory',
      },
      devices: [
        {
          providerDeviceId: 'camera-1',
          kind: 'camera',
          name: 'Main Camera',
        },
        {
          kind: 'unknown',
          name: 'Legacy Device',
        },
      ],
    })
    expect(requests).toEqual([
      '/management/apiversions',
      '/management/v1/description',
      '/management/v1/configureddevices',
    ])
  })

  it('rejects duplicate stable device IDs', async () => {
    const discovery = createAlpacaDiscovery({
      fetch: fakeFetch({
        '/management/apiversions': envelope([1]),
        '/management/v1/description': envelope({}),
        '/management/v1/configureddevices': envelope([
          {
            DeviceName: 'Main Camera',
            DeviceType: 'Camera',
            DeviceNumber: 0,
            UniqueID: 'camera-1',
          },
          {
            DeviceName: 'Guide Camera',
            DeviceType: 'Camera',
            DeviceNumber: 1,
            UniqueID: ' camera-1 ',
          },
        ]),
      }),
    })

    await expect(discovery.inspect(endpoint)).rejects.toMatchObject({
      name: 'AlpacaProviderError',
      reason: 'invalid-response',
    })
  })

  it('rejects malformed Management API JSON', async () => {
    const fetch = vi.fn(
      async () =>
        new Response('{not json', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )

    const discovery = createAlpacaDiscovery({ fetch })

    await expect(discovery.inspect(endpoint)).rejects.toMatchObject({
      name: 'AlpacaProviderError',
      reason: 'invalid-response',
    })
  })

  it('keeps Management API protocol errors structured', async () => {
    const discovery = createAlpacaDiscovery({
      fetch: fakeFetch({
        '/management/apiversions': envelope([], 1280, 'Management unavailable'),
      }),
    })

    await expect(discovery.inspect(endpoint)).rejects.toMatchObject({
      name: 'AlpacaProviderError',
      reason: 'protocol-error',
      message: 'Management unavailable',
      errorNumber: 1280,
    })
  })

  it('times out stalled Management API requests', async () => {
    vi.useFakeTimers()

    const fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          })
        }),
    )

    const discovery = createAlpacaDiscovery({ fetch })

    const inspection = discovery.inspect(endpoint, { requestTimeoutMs: 3_000 })

    const rejection = expect(inspection).rejects.toMatchObject({
      name: 'AlpacaProviderError',
      reason: 'transport',
    })

    await vi.advanceTimersByTimeAsync(3_000)

    await rejection
  })

  it('propagates caller cancellation without wrapping it as a provider failure', async () => {
    const cancellation = new Error('request cancelled')
    const controller = new AbortController()

    const fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
            once: true,
          })
        }),
    )

    const discovery = createAlpacaDiscovery({ fetch })

    const inspection = discovery.inspect(endpoint, { signal: controller.signal })
    controller.abort(cancellation)

    await expect(inspection).rejects.toBe(cancellation)
  })

  it('rejects invalid scan and inspection options before transport work', async () => {
    const discovery = createAlpacaDiscovery({
      udpScanner: { scan: vi.fn(async () => []) },
    })

    await expect(discovery.scan({ durationMs: 0 })).rejects.toThrow(RangeError)
    await expect(discovery.scan({ attempts: 1.5 })).rejects.toThrow(RangeError)
    await expect(discovery.inspect({ host: '', port: 11111 })).rejects.toThrow(RangeError)
    await expect(discovery.inspect({ host: 'localhost', port: 70_000 })).rejects.toThrow(RangeError)
  })
})
