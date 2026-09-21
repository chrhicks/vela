import { expect, it, vi } from 'vitest'
import { createAlpacaAcquisition, AlpacaCaptureRetryableError } from './acquisition.js'
import { AlpacaProviderError } from './error.js'
import type { ResponseFixture } from './internal/test-fixtures.js'

function cameraRig() {
  const camera = {
    DeviceName: 'Camera',
    DeviceType: 'Camera',
    DeviceNumber: 7,
    UniqueID: 'camera-id',
  }

  const state = {
    ready: true,
    exposing: false,
    starts: 0,
    aborts: 0,
    imageReads: 0,
    stamp: '2026-09-05T01:00:00',
  }

  const envelope = {
    ClientTransactionID: 0,
    ServerTransactionID: 1,
    ErrorNumber: 0,
    ErrorMessage: '',
  }

  const fetch: typeof globalThis.fetch = async (input, init) => {
    init?.signal?.throwIfAborted()
    const operation = new URL(String(input)).pathname.split('/').at(-1)
    let Value: ResponseFixture

    switch (operation) {
      case 'configureddevices':
        Value = [camera]
        break
      case 'connected':
      case 'canabortexposure':
        Value = true
        break
      case 'name':
        Value = camera.DeviceName
        break
      case 'sensortype':
        Value = 0
        break
      case 'numx':
      case 'numy':
        Value = 2
        break
      case 'camerastate':
        Value = state.exposing ? 2 : 0
        break
      case 'imageready':
        Value = state.ready
        break
      case 'lastexposurestarttime':
        Value = state.stamp
        break
      case 'startexposure':
        expect(init?.method).toBe('PUT')
        expect(String(init?.body)).toBe('Duration=1&Light=true')
        state.starts++
        state.ready = false
        state.exposing = true
        break
      case 'abortexposure':
        expect(init?.method).toBe('PUT')
        state.aborts++
        state.ready = false
        state.exposing = false
        break
      case 'imagearray':
        state.imageReads++

        return Response.json({
          ...envelope,
          Type: 2,
          Rank: 2,
          Value: [
            [1, 3],
            [2, 4],
          ],
        })
      default:
        throw new Error(`Unexpected request ${String(input)}`)
    }

    return Response.json({ ...envelope, Value })
  }

  return {
    state,
    fetch,
    complete() {
      state.ready = true
      state.exposing = false
      state.stamp = '2026-09-05T01:00:02'
    },
  }
}

function pendingBody(contentType: string) {
  let stream!: ReadableStreamDefaultController<Uint8Array>
  let reading!: () => void

  const started = new Promise<void>(resolve => {
    reading = resolve
  })

  const response = new Response(
    new ReadableStream<Uint8Array>(
      {
        start(controller) {
          stream = controller
        },
        pull() {
          reading()
        },
      },
      { highWaterMark: 0 },
    ),
    { headers: { 'content-type': contentType } },
  )

  return { response, stream, started }
}

it.each(['application/json', 'application/imagebytes'])(
  'recovers the same exposure after a post-header %s image stream termination',
  async contentType => {
    const rig = cameraRig()
    const body = pendingBody(contentType)
    let imageRequests = 0
    const readStates: string[] = []

    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (String(input).endsWith('/imagearray')) {
        imageRequests++

        if (imageRequests === 1) return body.response
      }

      return rig.fetch(input, init)
    }

    const acquisition = createAlpacaAcquisition({
      baseUrl: 'http://fake',
      fetch,
      readRetryIntervalMs: 10,
    })

    const result = acquisition.capture({
      cameraId: 'camera-id',
      exposureSeconds: 1,
      onReadState: state => {
        readStates.push(state)
        expect(rig.state.starts).toBe(1)
        expect(rig.state.aborts).toBe(0)
      },
    })

    await vi.waitFor(() => expect(rig.state.starts).toBe(1))
    rig.complete()
    await body.started
    const originalTimestamp = rig.state.stamp
    expect(readStates).toEqual([])
    expect(rig.state.starts).toBe(1)
    expect(rig.state.aborts).toBe(0)
    body.stream.enqueue(new Uint8Array([1, 0]))
    body.stream.error(new TypeError('terminated', { cause: new Error('ECONNRESET') }))
    const frame = await result
    expect(readStates).toEqual(['retrying', 'current'])
    expect(frame.capturedAt).toBe(`${originalTimestamp}Z`)
    expect(frame.capturedAtSource).toBeUndefined()
    expect(Array.from(frame.pixels)).toEqual([1, 2, 3, 4])
    expect(imageRequests).toBe(2)
    expect(rig.state.starts).toBe(1)
    expect(rig.state.aborts).toBe(0)
  },
)

it('does not replay StartExposure or classify a terminated acknowledgement body as a retryable capture', async () => {
  const rig = cameraRig()
  const body = pendingBody('application/json')
  const onReadState = vi.fn()
  const termination = new TypeError('terminated', { cause: new Error('ECONNRESET') })

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const response = await rig.fetch(input, init)

    return String(input).endsWith('/startexposure') ? body.response : response
  }

  const acquisition = createAlpacaAcquisition({
    baseUrl: 'http://fake',
    fetch,
    readRetryIntervalMs: 10,
  })

  const result = acquisition
    .capture({ cameraId: 'camera-id', exposureSeconds: 1, onReadState })
    .catch(error => error)

  await body.started
  expect(rig.state.starts).toBe(1)
  expect(rig.state.exposing).toBe(true)
  expect(rig.state.aborts).toBe(0)
  body.stream.enqueue(new TextEncoder().encode('{"ErrorNumber":'))
  body.stream.error(termination)
  const error = await result
  expect(error).toBeInstanceOf(AlpacaProviderError)
  expect(error).not.toBeInstanceOf(AlpacaCaptureRetryableError)
  expect(error).toMatchObject({ reason: 'transport', endpoint: '/api/v1/camera/7/startexposure' })
  expect(error.cause).toBe(termination)
  expect(onReadState).not.toHaveBeenCalled()
  expect(rig.state.starts).toBe(1)
  expect(rig.state.aborts).toBe(1)
  expect(rig.state.exposing).toBe(false)
  expect(rig.state.imageReads).toBe(0)
})
