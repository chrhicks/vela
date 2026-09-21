import { imageWidth, imageHeight } from './optics.js'
import { afterEach, expect, it } from 'vitest'
import { acceptsImageBytes, encodeImageBytes, imageJsonChunks } from './image-bytes.js'
import { buildSimulator } from './service.js'

const envelope = {
  ClientTransactionID: 4294967295,
  ServerTransactionID: 7,
  ErrorNumber: 0,
  ErrorMessage: '',
}

it('serializes the same pixels as Int32-source UInt16 ImageBytes and JSON in X/Y order', async () => {
  const frame = { width: 3, height: 2, pixels: new Uint16Array([0, 1, 65535, 10, 11, 60000]) }
  const bytes = await encodeImageBytes(frame, envelope)
  expect(Array.from({ length: 11 }, (_, index) => bytes.readUInt32LE(index * 4)))
    .toEqual([1, 0, 4294967295, 7, 44, 2, 8, 2, 3, 2, 0])
  expect(Array.from({ length: 6 }, (_, index) => bytes.readUInt16LE(44 + index * 2)))
    .toEqual([0, 10, 1, 11, 65535, 60000])
  let json = ''

  for await (const chunk of imageJsonChunks(frame, envelope)) json += chunk
  expect(JSON.parse(json)).toEqual({
    ...envelope,
    Type: 2,
    Rank: 2,
    Value: [[0, 10], [1, 11], [65535, 60000]],
  })
})

it('requires explicit nonzero ImageBytes acceptance', () => {
  expect(acceptsImageBytes('application/imagebytes, application/json;q=0.9')).toBe(true)
  expect(acceptsImageBytes('Application/ImageBytes; q=0.5')).toBe(true)

  for (const value of [undefined, '*/*', 'application/json', 'application/imagebytes;q=0', 'application/imagebytes;q=invalid']) {
    expect(acceptsImageBytes(value)).toBe(false)
  }
})

it('yields while serializing and rejects an invalidated frame', async () => {
  const frame = { width: 100, height: 2, pixels: new Uint16Array(200) }
  let current = true
  const check = () => { if (!current) throw new Error('Discarded frame') }

  const pending = encodeImageBytes(frame, envelope, check)
  current = false
  await expect(pending).rejects.toThrow('Discarded frame')
  current = true
  const chunks = imageJsonChunks(frame, envelope, check)
  await chunks.next()
  current = false
  await expect(chunks.next()).rejects.toThrow('Discarded frame')
})

const apps: ReturnType<typeof buildSimulator>[] = []

afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())) })

it('negotiates both cameras and preserves a completed frame across binary and JSON reads', async () => {
  const app = buildSimulator({ stars: [] })

  for (const cameraNumber of [0, 1]) await app.inject({
    method: 'PUT',
    url: '/simulator/camera',
    payload: { cameraNumber, resolution: 'fast' },
  })
  apps.push(app)

  for (const number of [0, 1]) {
    const path = `/api/v1/camera/${number}`
    const put = (member: string, payload: { Connected?: boolean; Duration?: number; Light?: boolean }) => app.inject({ method: 'PUT', url: `${path}/${member}`, payload })
    expect((await put('connected', { Connected: true })).json().ErrorNumber).toBe(0)
    expect((await app.inject(`${path}/sensortype`)).json().Value).toBe(number === 0 ? 0 : 2)

    if (number === 1) expect((await app.inject(`${path}/bayeroffsetx`)).json().Value).toBe(0)
    expect((await put('startexposure', { Duration: 0, Light: true })).json().ErrorNumber).toBe(0)
    const binary = await app.inject({ url: `${path}/imagearray?ClientTransactionID=12`, headers: { accept: 'application/imagebytes' } })
    expect(binary.headers['content-type']).toBe('application/imagebytes')
    expect(binary.rawPayload.readUInt32LE(8)).toBe(12)
    const json = (await app.inject(`${path}/imagearray`)).json()
    expect(json).toMatchObject({ Type: 2, Rank: 2, ErrorNumber: 0 })

    for (const [x, y] of [[0, 0], [Math.floor(imageWidth / 2), Math.floor(imageHeight / 2)], [imageWidth - 1, imageHeight - 1]]) {
      expect(binary.rawPayload.readUInt16LE(44 + (x! * imageHeight + y!) * 2)).toBe(json.Value[x!][y!])
    }
  }
})

it('validates all camera control fields before changing obstruction', async () => {
  const app = buildSimulator({ stars: [] })
  apps.push(app)

  const response = await app.inject({
    method: 'PUT',
    url: '/simulator/camera',
    payload: { obscured: true, cameraNumber: 5, resolution: 'full' },
  })

  expect(response.statusCode).toBe(400)
  expect((await app.inject('/simulator/state')).json().obscured).toBe(false)
})

it('returns negotiated ImageBytes error metadata when no frame is available', async () => {
  const app = buildSimulator({ stars: [] })
  apps.push(app)
  const response = await app.inject({ url: '/api/v1/camera/1/imagearray?ClientTransactionID=19', headers: { accept: 'application/imagebytes' } })
  expect(response.headers['content-type']).toBe('application/imagebytes')
  expect(response.rawPayload.readUInt32LE(4)).toBe(0x407)
  expect(response.rawPayload.readUInt32LE(8)).toBe(19)
  expect(response.rawPayload.readUInt32LE(16)).toBe(44)
  expect(response.rawPayload.subarray(44).toString('utf8')).toMatch(/disconnected/i)
})
