import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AlpacaProviderError,
  createAlpacaProvider,
  type AlpacaDevice,
} from './index.js'

type RouteResult = unknown | Error

function envelope(Value: unknown, ErrorNumber = 0, ErrorMessage = '') {
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
  return (async (input) => {
    const url = new URL(String(input))
    requests.push(url.pathname)
    const result = routes[url.pathname]

    if (result instanceof Error) {
      throw result
    }

    if (result instanceof Response) {
      return result
    }

    if (result === undefined) {
      return new Response('Not found', { status: 404 })
    }

    return Response.json(result)
  }) as typeof globalThis.fetch
}

const configuredCamera = {
  DeviceName: ' Main Camera ',
  DeviceType: 'Camera',
  DeviceNumber: 0,
  UniqueID: ' camera-1 ',
}

afterEach(() => {
  vi.useRealTimers()
})

describe('createAlpacaProvider', () => {
  it('returns normalized devices without exposing wire fields', async () => {
    const requests: string[] = []
    const provider = createAlpacaProvider({
      baseUrl: 'http://alpaca.test/',
      fetch: fakeFetch({
        '/management/v1/configureddevices': envelope([
          configuredCamera,
          {
            DeviceName: 'Mystery device',
            DeviceType: 'Video',
            DeviceNumber: 2,
            UniqueID: 'mystery-1',
          },
        ]),
        '/api/v1/camera/0/connected': envelope(true),
        '/api/v1/camera/0/driverinfo': envelope('Camera driver'),
        '/api/v1/camera/0/driverversion': envelope('1.2.3'),
        '/api/v1/video/2/connected': envelope(false),
        '/api/v1/video/2/driverinfo': envelope('Video driver'),
        '/api/v1/video/2/driverversion': envelope('2.0.0'),
      }, requests),
    })

    const devices = await provider.listDevices()

    expect(devices).toEqual<AlpacaDevice[]>([
      {
        providerDeviceId: 'camera-1',
        kind: 'camera',
        name: 'Main Camera',
        connection: 'connected',
        driver: { info: 'Camera driver', version: '1.2.3' },
      },
      {
        providerDeviceId: 'mystery-1',
        kind: 'unknown',
        name: 'Mystery device',
        connection: 'disconnected',
        driver: { info: 'Video driver', version: '2.0.0' },
      },
    ])
    expect(devices[0]).not.toHaveProperty('DeviceType')
    expect(devices[0]).not.toHaveProperty('DeviceNumber')
    expect(requests[0]).toBe('/management/v1/configureddevices')
  })

  it('degrades individual device failures without hiding the device', async () => {
    const provider = createAlpacaProvider({
      baseUrl: 'http://alpaca.test',
      fetch: fakeFetch({
        '/management/v1/configureddevices': envelope([configuredCamera]),
        '/api/v1/camera/0/connected': new Error('offline'),
        '/api/v1/camera/0/driverinfo': envelope(null),
        '/api/v1/camera/0/driverversion': envelope('', 1025, 'Not implemented'),
      }),
    })

    await expect(provider.listDevices()).resolves.toEqual([
      {
        providerDeviceId: 'camera-1',
        kind: 'camera',
        name: 'Main Camera',
        connection: 'unavailable',
        driver: {},
      },
    ])
  })

  it('rejects an incomplete operational identity inventory', async () => {
    const provider = createAlpacaProvider({
      baseUrl: 'http://alpaca.test',
      fetch: fakeFetch({
        '/management/v1/configureddevices': envelope([
          configuredCamera,
          {
            DeviceName: 'Legacy device',
            DeviceType: 'Camera',
            DeviceNumber: 3,
          },
        ]),
      }),
    })

    await expect(provider.listDevices()).rejects.toMatchObject({
      name: 'AlpacaProviderError',
      reason: 'invalid-response',
      endpoint: '/management/v1/configureddevices',
    })
    await expect(provider.inspectDevices()).rejects.toMatchObject({
      name: 'AlpacaProviderError',
      reason: 'invalid-response',
      endpoint: '/management/v1/configureddevices',
    })
  })

  it('rejects a configured device without a usable name', async () => {
    const provider = createAlpacaProvider({
      baseUrl: 'http://alpaca.test',
      fetch: fakeFetch({
        '/management/v1/configureddevices': envelope([{
          ...configuredCamera,
          DeviceName: '   ',
        }]),
      }),
    })

    await expect(provider.inspectDevices()).rejects.toMatchObject({
      name: 'AlpacaProviderError',
      reason: 'invalid-response',
      endpoint: '/management/v1/configureddevices',
    })
  })

  it('rejects duplicate stable device IDs as an invalid response', async () => {
    const provider = createAlpacaProvider({
      baseUrl: 'http://alpaca.test',
      fetch: fakeFetch({
        '/management/v1/configureddevices': envelope([
          configuredCamera,
          { ...configuredCamera, DeviceNumber: 1, UniqueID: 'camera-1' },
        ]),
      }),
    })

    await expect(provider.listDevices()).rejects.toMatchObject({
      name: 'AlpacaProviderError',
      reason: 'invalid-response',
    })
  })

  it('times out a stalled management request', async () => {
    vi.useFakeTimers()
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
          once: true,
        })
      }),
    ) as typeof globalThis.fetch
    const provider = createAlpacaProvider({
      baseUrl: 'http://alpaca.test',
      fetch,
    })

    const request = provider.listDevices()
    const rejection = expect(request).rejects.toMatchObject({
      name: 'AlpacaProviderError',
      reason: 'transport',
    })
    await vi.advanceTimersByTimeAsync(3_000)

    await rejection
  })

  it('classifies an HTTP error response as a protocol error', async () => {
    const provider = createAlpacaProvider({
      baseUrl: 'http://alpaca.test',
      fetch: fakeFetch({
        '/management/v1/configureddevices': new Response('Server error', { status: 500 }),
      }),
    })

    await expect(provider.listDevices()).rejects.toMatchObject({
      name: 'AlpacaProviderError',
      reason: 'protocol-error',
      endpoint: '/management/v1/configureddevices',
    })
  })

  it('rejects nonzero management response errors as protocol errors', async () => {
    const provider = createAlpacaProvider({
      baseUrl: 'http://alpaca.test',
      fetch: fakeFetch({
        '/management/v1/configureddevices': envelope([], 1280, 'Provider failed'),
      }),
    })

    await expect(provider.listDevices()).rejects.toMatchObject({
      name: 'AlpacaProviderError',
      reason: 'protocol-error',
      errorNumber: 1280,
      message: 'Provider failed',
    })
  })

  it('classifies management transport failures', async () => {
    const provider = createAlpacaProvider({
      baseUrl: 'http://alpaca.test',
      fetch: fakeFetch({
        '/management/v1/configureddevices': new Error('network down'),
      }),
    })

    await expect(provider.listDevices()).rejects.toMatchObject({
      name: 'AlpacaProviderError',
      reason: 'transport',
    })
  })

  it('classifies invalid management responses', async () => {
    const provider = createAlpacaProvider({
      baseUrl: 'http://alpaca.test',
      fetch: fakeFetch({
        '/management/v1/configureddevices': { Value: [] },
      }),
    })

    try {
      await provider.listDevices()
      throw new Error('Expected listDevices to reject')
    } catch (error) {
      expect(error).toBeInstanceOf(AlpacaProviderError)
      expect(error).toMatchObject({ reason: 'invalid-response' })
    }
  })
})
