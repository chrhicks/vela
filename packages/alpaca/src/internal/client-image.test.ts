import { afterEach, expect, it, vi } from 'vitest'
import { createAlpacaClient } from './client.js'

afterEach(() => vi.useRealTimers())

it.each(['application/json', 'application/imagebytes'])('bounds %s image transfer independently of ordinary reads', async contentType => {
  vi.useFakeTimers()

  const fetch: typeof globalThis.fetch = async (_input, init) => {
    const response = Response.json({}, { headers: { 'content-type': contentType } })

    const pending = () => new Promise<never>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true })
    })

    response.json = pending
    response.arrayBuffer = pending

    return response
  }

  const client = createAlpacaClient({ baseUrl: 'http://fake', fetch, requestTimeoutMs: 5_000, imageTimeoutMs: 60_000 })
  const camera = { DeviceName: 'Camera', DeviceType: 'Camera', DeviceNumber: 0, UniqueID: 'camera' }
  let imageSettled = false
  const image = client.image(camera).finally(() => { imageSettled = true })
  const imageFailure = expect(image).rejects.toThrow('timed out after 60000ms')
  const stateFailure = expect(client.connected(camera)).rejects.toThrow('timed out after 5000ms')
  await vi.advanceTimersByTimeAsync(5_000)
  await stateFailure
  expect(imageSettled).toBe(false)
  await vi.advanceTimersByTimeAsync(55_000)
  await imageFailure
})

it('negotiates ImageBytes and uses the actual response Content-Type for JSON fallback', async () => {
  const camera = { DeviceName: 'Camera', DeviceType: 'Camera', DeviceNumber: 0, UniqueID: 'camera' }
  const json = { ErrorNumber: 0, ErrorMessage: '', ClientTransactionID: 0, ServerTransactionID: 1, Type: 2, Rank: 2, Value: [[7]] }
  const bytes = new ArrayBuffer(46)
  const metadata = new DataView(bytes)
  const fields = [1, 0, 0, 1, 44, 2, 8, 2, 1, 1, 0]
  fields.forEach((value, index) => metadata.setInt32(index * 4, value, true))
  metadata.setUint16(44, 7, true)

  for (const binary of [true, false]) {
    let requests = 0

    const fetch: typeof globalThis.fetch = async (_input, init) => {
      requests++
      expect(new Headers(init?.headers).get('accept')).toBe('application/imagebytes, application/json;q=0.9')

      return binary
        ? new Response(bytes, { headers: { 'content-type': 'Application/ImageBytes; version=1' } })
        : Response.json(json)
    }

    const client = createAlpacaClient({ baseUrl: 'http://fake', fetch })
    const result = await client.image(camera)
    expect(binary ? Array.from(new Uint8Array(result as ArrayBuffer)) : result).toEqual(binary ? Array.from(new Uint8Array(bytes)) : json)
    expect(requests).toBe(1)
  }
})

it('rejects an unrecognized Content-Type and preserves a JSON protocol error', async () => {
  const camera = { DeviceName: 'Camera', DeviceType: 'Camera', DeviceNumber: 0, UniqueID: 'camera' }
  const unsupported = createAlpacaClient({ baseUrl: 'http://fake', fetch: async () => new Response('binary?', { headers: { 'content-type': 'application/octet-stream' } }) })
  await expect(unsupported.image(camera)).rejects.toMatchObject({ reason: 'invalid-response' })
  const failed = createAlpacaClient({ baseUrl: 'http://fake', fetch: async () => Response.json({ ClientTransactionID: 0, ServerTransactionID: 1, ErrorNumber: 1025, ErrorMessage: 'Camera disconnected' }) })
  await expect(failed.image(camera)).rejects.toMatchObject({ reason: 'protocol-error', errorNumber: 1025 })
})
