import type { ResponseFixture } from './internal/test-fixtures.js'
import { describe, expect, it, vi } from 'vitest'
import {
  createAlpacaAcquisition,
  AlpacaCaptureStoppedError,
  AlpacaCaptureRetryableError,
} from './acquisition.js'
import { AlpacaProviderError } from './error.js'

function observatory() {
  const camera = {
    DeviceName: 'Camera',
    DeviceType: 'Camera',
    DeviceNumber: 7,
    UniqueID: 'camera-id',
  }

  const telescope = {
    DeviceName: 'Mount',
    DeviceType: 'Telescope',
    DeviceNumber: 3,
    UniqueID: 'mount-id',
  }

  interface CameraFixture {
    Type: number
    Rank: number
    Value: ResponseFixture
  }

  interface ObservatoryState {
    cameraName: string
    sensorType: number
    binX: number
    binY: number
    offsetX: number
    offsetY: number
    startX: number
    startY: number
    unsupportedOffset: boolean
    ready: boolean
    exposing: boolean
    rate: number
    raDegrees: number
    raStep: number
    raReadFails: boolean
    imageBinary: ArrayBuffer | null
    image: CameraFixture
    stamp: string
    stampError: number
    imageReads: number
    pendingReadyReads: number
    stale: boolean
    starts: number
    moves: number[]
    aborts: number
    lostStart: boolean
    lostMove: boolean
    stopFails: boolean
    pendingStopReads: number
    stopping: boolean
    cameraStopFails: boolean
  }

  const state: ObservatoryState = {
    cameraName: ' Camera ',
    sensorType: 0,
    binX: 1,
    binY: 1,
    offsetX: 0,
    offsetY: 0,
    startX: 0,
    startY: 0,
    unsupportedOffset: false,
    ready: true,
    exposing: false,
    rate: 0,
    raDegrees: 30,
    raStep: 2,
    raReadFails: false,
    imageBinary: null,
    image: {
      Type: 2,
      Rank: 2,
      Value: [
        [1, 3],
        [2, 4],
      ],
    },
    stamp: '2026-09-05T01:00:00',
    stampError: 0,
    imageReads: 0,
    pendingReadyReads: 0,
    stale: false,
    starts: 0,
    moves: [],
    aborts: 0,
    lostStart: false,
    lostMove: false,
    stopFails: false,
    pendingStopReads: 0,
    stopping: false,
    cameraStopFails: false,
  }

  const fetch: typeof globalThis.fetch = async (input, init) => {
    init?.signal?.throwIfAborted()
    const url = new URL(String(input))
    const operation = url.pathname.split('/').at(-1)
    const parameters = new URLSearchParams(String(init?.body ?? ''))
    let Value: ResponseFixture

    if (operation === 'configureddevices') Value = [camera, telescope]
    else if (
      operation === 'connected' ||
      operation === 'canabortexposure' ||
      operation === 'canmoveaxis' ||
      operation === 'tracking'
    )
      Value = true
    else if (operation === 'rightascension') {
      if (state.raReadFails && state.rate !== 0) throw new TypeError('RA read failed')

      if (state.rate !== 0)
        state.raDegrees = (state.raDegrees + Math.sign(state.rate) * state.raStep + 360) % 360
      Value = state.raDegrees / 15
    } else if (operation === 'name') Value = state.cameraName
    else if (operation === 'axisrates') Value = [{ Minimum: 0, Maximum: 1.5 }]
    else if (operation === 'sensortype') Value = state.sensorType
    else if (operation === 'binx') Value = state.binX
    else if (operation === 'biny') Value = state.binY
    else if (operation === 'bayeroffsetx' || operation === 'bayeroffsety') {
      if (state.unsupportedOffset)
        return Response.json({
          ClientTransactionID: 0,
          ServerTransactionID: 1,
          ErrorNumber: 1024,
          ErrorMessage: 'Not implemented',
        })
      Value = operation === 'bayeroffsetx' ? state.offsetX : state.offsetY
    } else if (operation === 'startx') Value = state.startX
    else if (operation === 'starty') Value = state.startY
    else if (operation === 'numx' || operation === 'numy') Value = 2
    else if (operation === 'camerastate') Value = state.exposing ? 2 : 0
    else if (operation === 'imageready') {
      Value = state.ready

      if (state.starts > 0 && !state.ready) state.pendingReadyReads++
    } else if (operation === 'slewing') {
      Value = state.rate !== 0 || (state.stopping && state.pendingStopReads-- > 0)
    } else if (operation === 'lastexposurestarttime') {
      if (state.stampError)
        return Response.json({
          ClientTransactionID: 0,
          ServerTransactionID: 1,
          ErrorNumber: state.stampError,
          ErrorMessage: 'Timestamp unavailable',
        })
      Value = state.stamp
    } else if (operation === 'declination') Value = 60
    else if (operation === 'sitelatitude') Value = 35
    else if (operation === 'siderealtime') Value = 4
    else if (operation === 'equatorialsystem') Value = 0
    else if (operation === 'startexposure') {
      state.starts++

      if (!state.stale) {
        state.ready = false
        state.exposing = true
      }

      if (state.lostStart) throw new TypeError('Response lost after accepting exposure')
    } else if (operation === 'abortexposure') {
      state.aborts++

      if (state.cameraStopFails) throw new TypeError('Cannot reach camera to stop it')
      state.exposing = false
      state.ready = false
    } else if (operation === 'moveaxis') {
      const rate = Number(parameters.get('Rate'))
      state.moves.push(rate)

      if (rate === 0 && state.stopFails) throw new TypeError('Cannot reach mount to stop it')
      state.rate = rate
      state.stopping = rate === 0

      if (rate !== 0 && state.lostMove) throw new TypeError('Response lost after motion began')
    } else if (operation === 'imagearray') {
      state.imageReads++

      if (state.imageBinary)
        return new Response(state.imageBinary, {
          headers: { 'content-type': 'application/imagebytes' },
        })

      return Response.json({
        ClientTransactionID: 0,
        ServerTransactionID: 1,
        ErrorNumber: 0,
        ErrorMessage: '',
        ...state.image,
      })
    } else throw new Error(`Unexpected request ${url.pathname}`)

    return Response.json({
      ClientTransactionID: 0,
      ServerTransactionID: 1,
      ErrorNumber: 0,
      ErrorMessage: '',
      Value,
    })
  }

  return {
    state,
    fetch,
    acquisition: createAlpacaAcquisition({ baseUrl: 'http://fake', fetch }),
    complete() {
      state.ready = true
      state.exposing = false
      state.stamp = '2026-09-05T01:00:02'
    },
  }
}

async function started(rig: ReturnType<typeof observatory>) {
  await vi.waitFor(() => expect(rig.state.starts).toBe(1))
}

describe('normalized Alpaca acquisition', () => {
  function readTimeout(operation: string, afterStart = false) {
    const rig = observatory()
    const reads = { unavailable: true, attempts: 0 }

    const fetch: typeof globalThis.fetch = async (input, init) => {
      const current = new URL(String(input)).pathname.split('/').at(-1)

      if (reads.unavailable && current === operation && (!afterStart || rig.state.starts > 0)) {
        reads.attempts++
        const signal = init!.signal!

        return new Promise<Response>((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
      }

      if (afterStart && rig.state.starts > 0 && current === 'imageready') rig.complete()

      return rig.fetch(input, init)
    }

    return {
      ...rig,
      reads,
      acquisition: createAlpacaAcquisition({
        baseUrl: 'http://fake',
        fetch,
        requestTimeoutMs: 10,
        imageTimeoutMs: 10,
        readRetryIntervalMs: 10,
      }),
    }
  }

  it('classifies a device-list timeout before any write as a retryable capture', async () => {
    const rig = readTimeout('configureddevices')

    const error = await rig.acquisition
      .capture({ cameraId: 'camera-id', exposureSeconds: 1 })
      .catch(error => error)

    expect(error).toBeInstanceOf(AlpacaCaptureRetryableError)
    expect(error.cause).toBeInstanceOf(AlpacaProviderError)
    expect(error.cause).toMatchObject({
      reason: 'transport',
      endpoint: '/management/v1/configureddevices',
    })
    expect(rig.state.starts).toBe(0)
    expect(rig.state.aborts).toBe(0)
  })

  it.each(['imageready', 'lastexposurestarttime', 'imagearray'])(
    'recovers the same acknowledged exposure after repeated %s timeouts beyond the old cleanup budget',
    async operation => {
      const rig = readTimeout(operation, true)
      const monotonic = vi.spyOn(performance, 'now').mockReturnValue(0)
      const readStates: string[] = []
      const controller = new AbortController()

      const result = rig.acquisition.capture({
        cameraId: 'camera-id',
        exposureSeconds: 1,
        signal: controller.signal,
        onReadState: state => readStates.push(state),
      })

      try {
        await vi.waitFor(() => expect(readStates).toEqual(['retrying']))
        monotonic.mockReturnValue(70_000)
        await vi.waitFor(() => expect(rig.reads.attempts).toBeGreaterThanOrEqual(3))
        expect(rig.state.starts).toBe(1)
        expect(rig.state.aborts).toBe(0)
        rig.reads.unavailable = false
        const frame = await result
        expect(readStates).toEqual(['retrying', 'current'])
        expect(frame.capturedAt).toBe('2026-09-05T01:00:02Z')
        expect(Array.from(frame.pixels)).toEqual([1, 2, 3, 4])
        expect(rig.state.starts).toBe(1)
        expect(rig.state.aborts).toBe(0)
      } finally {
        controller.abort()
        await result.catch(() => {})
        monotonic.mockRestore()
      }
    },
  )

  it('keeps cleanup failure uncertain when Stop interrupts repeated exposure-read timeouts', async () => {
    const rig = readTimeout('imageready', true)
    rig.state.cameraStopFails = true
    const controller = new AbortController()
    const onReadState = vi.fn()

    const result = rig.acquisition
      .capture({
        cameraId: 'camera-id',
        exposureSeconds: 1,
        signal: controller.signal,
        onReadState,
      })
      .catch(error => error)

    await vi.waitFor(() => expect(onReadState).toHaveBeenCalledWith('retrying'))
    controller.abort()
    const error = await result
    expect(error).not.toBeInstanceOf(AlpacaCaptureRetryableError)
    expect(error).toMatchObject({ reason: 'transport', endpoint: '/api/v1/camera/7/abortexposure' })
    expect(rig.state.starts).toBe(1)
    expect(rig.state.aborts).toBe(1)
    expect(rig.state.exposing).toBe(true)
  })

  it('requires observed idle after the cleanup command before allowing a fresh capture', async () => {
    const rig = observatory()

    const fetch: typeof globalThis.fetch = async (input, init) => {
      const operation = new URL(String(input)).pathname.split('/').at(-1)

      if (operation === 'imageready' && rig.state.starts > 0)
        throw new TypeError('Read connection lost')

      const response = await rig.fetch(input, init)

      if (operation === 'abortexposure') rig.state.exposing = true

      return response
    }

    const acquisition = createAlpacaAcquisition({ baseUrl: 'http://fake', fetch })
    const controller = new AbortController()
    const onReadState = vi.fn()

    const result = acquisition
      .capture({
        cameraId: 'camera-id',
        exposureSeconds: 1,
        signal: controller.signal,
        onReadState,
      })
      .catch(error => error)

    await vi.waitFor(() => expect(onReadState).toHaveBeenCalledWith('retrying'))
    controller.abort()
    const error = await result
    expect(error).not.toBeInstanceOf(AlpacaCaptureRetryableError)
    expect(error.message).toBe('Camera did not confirm exposure stopped')
    expect(rig.state.starts).toBe(1)
    expect(rig.state.aborts).toBe(1)
  })

  it.each(['request', 'wait'])(
    'Stop cancels a pending read %s and independently confirms the single abort',
    async stage => {
      const rig = observatory()
      const controller = new AbortController()
      let pending = false
      let readSignal: AbortSignal | undefined
      let cleanupSignal: AbortSignal | undefined
      const onReadState = vi.fn()

      const fetch: typeof globalThis.fetch = async (input, init) => {
        const operation = new URL(String(input)).pathname.split('/').at(-1)

        if (operation === 'imageready' && rig.state.starts > 0) {
          if (stage === 'wait') throw new TypeError('Connection unavailable')
          readSignal = init!.signal!
          pending = true

          return new Promise<Response>((_, reject) =>
            readSignal!.addEventListener('abort', () => reject(readSignal!.reason), { once: true }),
          )
        }

        if (operation === 'abortexposure') cleanupSignal = init!.signal!

        return rig.fetch(input, init)
      }

      const acquisition = createAlpacaAcquisition({
        baseUrl: 'http://fake',
        fetch,
        readRetryIntervalMs: 60_000,
      })

      const result = acquisition.capture({
        cameraId: 'camera-id',
        exposureSeconds: 20,
        signal: controller.signal,
        onReadState,
      })

      const rejection = expect(result).rejects.toBeInstanceOf(AlpacaCaptureStoppedError)
      await vi.waitFor(() =>
        expect(stage === 'request' ? pending : onReadState.mock.calls.length === 1).toBe(true),
      )
      controller.abort()
      await rejection
      expect(rig.state.starts).toBe(1)
      expect(rig.state.aborts).toBe(1)
      expect(rig.state.exposing).toBe(false)
      expect(cleanupSignal?.aborted).toBe(false)
      expect(onReadState).not.toHaveBeenCalledWith('current')

      if (stage === 'request') expect(readSignal?.aborted).toBe(true)
    },
  )

  it.each([2, 5])(
    'does not restart a recovered camera that reports incomplete/error state %i',
    async cameraState => {
      const rig = observatory()
      const monotonic = vi.spyOn(performance, 'now').mockReturnValue(0)
      let unavailable = true
      const onReadState = vi.fn()

      const fetch: typeof globalThis.fetch = async (input, init) => {
        const operation = new URL(String(input)).pathname.split('/').at(-1)

        if (operation === 'imageready' && rig.state.starts > 0 && unavailable)
          throw new TypeError('Connection unavailable')

        if (operation === 'camerastate' && rig.state.starts > 0 && rig.state.aborts === 0) {
          return Response.json({
            ClientTransactionID: 0,
            ServerTransactionID: 1,
            ErrorNumber: 0,
            ErrorMessage: '',
            Value: cameraState,
          })
        }

        return rig.fetch(input, init)
      }

      const acquisition = createAlpacaAcquisition({
        baseUrl: 'http://fake',
        fetch,
        readRetryIntervalMs: 10,
      })

      const result = acquisition.capture({ cameraId: 'camera-id', exposureSeconds: 1, onReadState })

      const rejection = expect(result).rejects.toThrow(
        cameraState === 5
          ? 'Camera reported an exposure error'
          : 'Camera exposure did not complete in time',
      )

      try {
        await vi.waitFor(() => expect(onReadState).toHaveBeenCalledWith('retrying'))
        monotonic.mockReturnValue(70_000)
        unavailable = false
        await rejection
        expect(rig.state.starts).toBe(1)
        expect(rig.state.aborts).toBe(1)
        expect(rig.state.imageReads).toBe(0)
        expect(onReadState).not.toHaveBeenCalledWith('current')
      } finally {
        monotonic.mockRestore()
      }
    },
  )

  it('does not abort a replacement camera found after an interruption', async () => {
    const rig = readTimeout('imageready', true)
    const onReadState = vi.fn()

    const result = rig.acquisition.capture({
      cameraId: 'camera-id',
      exposureSeconds: 1,
      onReadState,
    })

    const rejection = expect(result).rejects.toThrow('original exposure outcome is unconfirmed')
    await vi.waitFor(() => expect(onReadState).toHaveBeenCalledWith('retrying'))
    rig.state.cameraName = 'Replacement camera'
    rig.reads.unavailable = false
    await rejection
    expect(rig.state.starts).toBe(1)
    expect(rig.state.aborts).toBe(0)
    expect(rig.state.imageReads).toBe(0)
  })

  it.each([false, true])(
    'retries an image-body timeout and checks the recovered image identity (replaced: %s)',
    async replaced => {
      const rig = observatory()
      let unavailable = true
      const onReadState = vi.fn()

      const fetch: typeof globalThis.fetch = async (input, init) => {
        const operation = new URL(String(input)).pathname.split('/').at(-1)

        if (operation === 'imagearray' && unavailable) {
          const signal = init!.signal!

          return new Response(
            new ReadableStream({
              start(stream) {
                signal.addEventListener('abort', () => stream.error(signal.reason), { once: true })
              },
            }),
            { headers: { 'content-type': 'application/imagebytes' } },
          )
        }

        return rig.fetch(input, init)
      }

      const acquisition = createAlpacaAcquisition({
        baseUrl: 'http://fake',
        fetch,
        imageTimeoutMs: 10,
        readRetryIntervalMs: 10,
      })

      const result = acquisition.capture({ cameraId: 'camera-id', exposureSeconds: 1, onReadState })

      const settled = replaced
        ? expect(result).rejects.toThrow('Exposure changed before image transfer')
        : expect(result).resolves.toMatchObject({
            capturedAt: '2026-09-05T01:00:02Z',
            pixels: new Float64Array([1, 2, 3, 4]),
          })

      await started(rig)
      rig.complete()
      await vi.waitFor(() => expect(onReadState).toHaveBeenCalledWith('retrying'))
      expect(rig.state.aborts).toBe(0)

      if (replaced) rig.state.stamp = '2026-09-05T01:00:04'
      unavailable = false
      await settled
      expect(rig.state.starts).toBe(1)
      expect(rig.state.aborts).toBe(replaced ? 1 : 0)
      expect(onReadState.mock.calls.map(([state]) => state)).toEqual(
        replaced ? ['retrying'] : ['retrying', 'current'],
      )
    },
  )

  it('retains the original server-estimated timestamp through image-read recovery', async () => {
    const rig = observatory()
    rig.state.stamp = ''
    let unavailable = true
    const onReadState = vi.fn()

    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (String(input).endsWith('/imagearray') && unavailable)
        throw new TypeError('Transfer unavailable')

      return rig.fetch(input, init)
    }

    const acquisition = createAlpacaAcquisition({
      baseUrl: 'http://fake',
      fetch,
      readRetryIntervalMs: 10,
    })

    const before = Date.now()
    const result = acquisition.capture({ cameraId: 'camera-id', exposureSeconds: 1, onReadState })
    await vi.waitFor(() => expect(rig.state.pendingReadyReads).toBeGreaterThan(0))
    const afterStart = Date.now()
    rig.complete()
    rig.state.stamp = ''
    await vi.waitFor(() => expect(onReadState).toHaveBeenCalledWith('retrying'))
    unavailable = false
    const frame = await result
    expect(frame.capturedAtSource).toBe('server-estimate')
    expect(Date.parse(frame.capturedAt)).toBeGreaterThanOrEqual(before)
    expect(Date.parse(frame.capturedAt)).toBeLessThanOrEqual(afterStart)
    expect(rig.state.starts).toBe(1)
    expect(rig.state.aborts).toBe(0)
  })

  it('waits for a new completed exposure and transposes x/y wire pixels into row-major pixels', async () => {
    const rig = observatory()
    let resolved = false

    const result = rig.acquisition
      .capture({
        cameraId: 'camera-id',
        expectedCameraName: 'Camera',
        exposureSeconds: 1,
      })
      .then(frame => {
        resolved = true

        return frame
      })

    await started(rig)
    expect(resolved).toBe(false)
    rig.complete()
    const frame = await result
    expect(Array.from(frame.pixels)).toEqual([1, 2, 3, 4])
    expect(frame.color).toEqual({ kind: 'mono' })
    expect(frame.capturedAt).toBe('2026-09-05T01:00:02Z')
    expect(frame.capturedAtSource).toBeUndefined()
    expect(rig.state.aborts).toBe(0)
  })

  it('captures a Bayer ImageBytes exposure through the same normalized frame contract', async () => {
    const rig = observatory()
    rig.state.sensorType = 2
    const bytes = new ArrayBuffer(52)
    const view = new DataView(bytes)
    const header = [1, 0, 0, 1, 44, 2, 8, 2, 2, 2, 0]
    header.forEach((value, index) => view.setInt32(index * 4, value, true))
    const samples = [1, 3, 2, 65535]
    samples.forEach((value, index) => view.setUint16(44 + index * 2, value, true))
    rig.state.imageBinary = bytes
    const result = rig.acquisition.capture({ cameraId: 'camera-id', exposureSeconds: 1 })
    await started(rig)
    rig.complete()
    const frame = await result
    expect(frame.color).toEqual({ kind: 'bayer', pattern: 'rggb' })
    expect(Array.from(frame.pixels)).toEqual([1, 2, 3, 65535])
  })

  it.each(['Different camera', ''])(
    'rejects a changed or missing operational camera identity before exposure: %j',
    async cameraName => {
      const rig = observatory()
      rig.state.cameraName = cameraName
      await expect(
        rig.acquisition.capture({
          cameraId: 'camera-id',
          expectedCameraName: 'Camera',
          exposureSeconds: 1,
        }),
      ).rejects.toThrow()
      expect(rig.state.starts).toBe(0)
      expect(rig.state.aborts).toBe(0)
    },
  )

  it.each([
    { offsetX: 0, offsetY: 0, startX: 0, startY: 0, pattern: 'rggb' },
    { offsetX: 1, offsetY: 0, startX: 0, startY: 0, pattern: 'grbg' },
    { offsetX: 0, offsetY: 1, startX: 0, startY: 0, pattern: 'gbrg' },
    { offsetX: 1, offsetY: 1, startX: 0, startY: 0, pattern: 'bggr' },
    { offsetX: 0, offsetY: 0, startX: 3, startY: 5, pattern: 'bggr' },
    { offsetX: 1, offsetY: 1, startX: 3, startY: 5, pattern: 'rggb' },
    { offsetX: 1, offsetY: 0, startX: 3, startY: 4, pattern: 'rggb' },
  ])(
    'normalizes Bayer phase for sensor offsets and subframe origin: %j',
    async ({ pattern, ...settings }) => {
      const rig = observatory()
      Object.assign(rig.state, settings, { sensorType: 2 })
      const result = rig.acquisition.capture({ cameraId: 'camera-id', exposureSeconds: 1 })
      await started(rig)
      rig.complete()
      const frame = await result
      expect(frame.color).toEqual({ kind: 'bayer', pattern })
      expect(Array.from(frame.pixels)).toEqual([1, 2, 3, 4])
    },
  )

  it.each([
    { sensorType: 1 },
    { sensorType: 3 },
    { sensorType: 4 },
    { sensorType: 5 },
    { sensorType: -1 },
    { sensorType: 1.5 },
    { binX: 2 },
    { binY: 2 },
    { binX: 0 },
    { binY: 1.5 },
    { offsetX: 2 },
    { offsetY: -1 },
    { offsetX: 0.5 },
    { startX: -1 },
    { startY: 0.5 },
    { startX: 2147483648 },
    { unsupportedOffset: true },
  ])(
    'rejects unsupported or malformed color interpretation before starting: %j',
    async settings => {
      const rig = observatory()
      Object.assign(rig.state, { sensorType: 2 }, settings)
      await expect(
        rig.acquisition.capture({ cameraId: 'camera-id', exposureSeconds: 1 }),
      ).rejects.toThrow()
      expect(rig.state.starts).toBe(0)
      expect(rig.state.aborts).toBe(0)
    },
  )

  it('preserves the pre-exposure restriction for a monochrome-only consumer', async () => {
    const rig = observatory()
    rig.state.sensorType = 2
    await expect(
      rig.acquisition.capture({
        cameraId: 'camera-id',
        exposureSeconds: 1,
        monochromeOnly: true,
      }),
    ).rejects.toThrow('requires a monochrome camera')
    expect(rig.state.starts).toBe(0)
    expect(rig.state.aborts).toBe(0)
  })

  it.each([
    { Type: 2, Rank: 3, Value: [[[1]]] },
    { Type: 2, Rank: 2, Value: [[1, 2], [3]] },
    {
      Type: 2,
      Rank: 2,
      Value: [
        [1, 2],
        [3, 2 ** 32],
      ],
    },
    {
      Type: 3,
      Rank: 2,
      Value: [
        [1, 2],
        [3, 4],
      ],
    },
  ])('rejects unsupported or malformed image data: %j', async image => {
    const rig = observatory()
    rig.state.image = image
    const result = rig.acquisition.capture({ cameraId: 'camera-id', exposureSeconds: 1 })
    const rejection = expect(result).rejects.toMatchObject({ reason: 'invalid-response' })
    await started(rig)
    rig.complete()
    await rejection
  })

  it('does not mistake a retained old image for the requested exposure', async () => {
    const rig = observatory()
    rig.state.stale = true
    await expect(
      rig.acquisition.capture({ cameraId: 'camera-id', exposureSeconds: 1 }),
    ).rejects.toThrow('freshness is unconfirmed')
  })

  it.each([0, 1024])(
    'estimates start time only after a fresh ready transition when the timestamp is blank or unsupported (%i)',
    async stampError => {
      const rig = observatory()
      Object.assign(rig.state, { stamp: '', stampError })
      const before = Date.now()
      const result = rig.acquisition.capture({ cameraId: 'camera-id', exposureSeconds: 1 })
      await vi.waitFor(() => expect(rig.state.pendingReadyReads).toBeGreaterThan(0))
      const afterStart = Date.now()
      rig.complete()
      rig.state.stamp = ''
      const frame = await result
      expect(frame.capturedAtSource).toBe('server-estimate')
      expect(Date.parse(frame.capturedAt)).toBeGreaterThanOrEqual(before)
      expect(Date.parse(frame.capturedAt)).toBeLessThanOrEqual(afterStart)
      expect(rig.state.imageReads).toBe(1)
      expect(rig.state.starts).toBe(1)
      expect(rig.state.aborts).toBe(0)
    },
  )

  it.each([0, 1024])(
    'rejects retained-ready images without a usable timestamp (%i)',
    async stampError => {
      const rig = observatory()
      Object.assign(rig.state, { stamp: '', stampError, stale: true })
      await expect(
        rig.acquisition.capture({ cameraId: 'camera-id', exposureSeconds: 1 }),
      ).rejects.toThrow('freshness is unconfirmed')
      expect(rig.state.imageReads).toBe(0)
      expect(rig.state.starts).toBe(1)
      expect(rig.state.aborts).toBe(1)
    },
  )

  it.each([
    { stamp: 'not a timestamp', stampError: 0 },
    { stamp: '', stampError: 1035 },
  ])('does not hide malformed timestamps or other driver errors: %j', async timestamp => {
    const rig = observatory()
    const result = rig.acquisition.capture({ cameraId: 'camera-id', exposureSeconds: 1 })
    const rejection = expect(result).rejects.toThrow()
    await vi.waitFor(() => expect(rig.state.pendingReadyReads).toBeGreaterThan(0))
    rig.complete()
    Object.assign(rig.state, timestamp)
    await rejection
    expect(rig.state.imageReads).toBe(0)
    expect(rig.state.starts).toBe(1)
  })

  it('does not use a missing timestamp to accept a lost exposure command response', async () => {
    const rig = observatory()
    Object.assign(rig.state, { stamp: '', lostStart: true })
    await expect(
      rig.acquisition.capture({ cameraId: 'camera-id', exposureSeconds: 1 }),
    ).rejects.toThrow()
    expect(rig.state.starts).toBe(1)
    expect(rig.state.imageReads).toBe(0)
    expect(rig.state.aborts).toBe(1)
  })

  it('confirms cancellation before starting without aborting someone else’s exposure', async () => {
    const rig = observatory()
    rig.state.exposing = true
    const controller = new AbortController()
    controller.abort()
    await expect(
      rig.acquisition.capture({
        cameraId: 'camera-id',
        exposureSeconds: 1,
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(AlpacaCaptureStoppedError)
    expect(rig.state.starts).toBe(0)
    expect(rig.state.aborts).toBe(0)
    expect(rig.state.exposing).toBe(true)
  })

  it('aborts a pending exposure with an independent signal after cancellation', async () => {
    const rig = observatory()
    const controller = new AbortController()

    const result = rig.acquisition.capture({
      cameraId: 'camera-id',
      exposureSeconds: 1,
      signal: controller.signal,
    })

    const rejection = expect(result).rejects.toBeInstanceOf(AlpacaCaptureStoppedError)
    await started(rig)
    controller.abort()
    await rejection
    expect(rig.state.aborts).toBe(1)
    expect(rig.state.exposing).toBe(false)
  })

  it('does not report confirmed cancellation when camera cleanup fails', async () => {
    const rig = observatory()
    const controller = new AbortController()

    const result = rig.acquisition.capture({
      cameraId: 'camera-id',
      exposureSeconds: 1,
      signal: controller.signal,
    })

    const rejection = expect(result).rejects.not.toBeInstanceOf(AlpacaCaptureStoppedError)
    await started(rig)
    rig.state.cameraStopFails = true
    controller.abort()
    await rejection
    expect(rig.state.exposing).toBe(true)
    expect(rig.state.aborts).toBe(1)
  })

  it('does not replay an exposure whose command response was lost', async () => {
    const rig = observatory()
    rig.state.lostStart = true

    const error = await rig.acquisition
      .capture({ cameraId: 'camera-id', exposureSeconds: 1 })
      .catch(error => error)

    expect(error).not.toBeInstanceOf(AlpacaCaptureRetryableError)
    expect(error).toMatchObject({ reason: 'transport', endpoint: '/api/v1/camera/7/startexposure' })
    expect(rig.state.starts).toBe(1)
    expect(rig.state.aborts).toBe(1)
    expect(rig.state.exposing).toBe(false)
  })

  it('waits for delayed stop telemetry without repeating the stop command', async () => {
    const rig = observatory()
    rig.state.pendingStopReads = 3
    await rig.acquisition.move('mount-id', 1, 0)
    expect(rig.state.moves).toEqual([1, 0])
    expect(rig.state.pendingStopReads).toBe(-1)
  })

  it('waits for delayed stop telemetry during explicit abort', async () => {
    const rig = observatory()
    rig.state.pendingStopReads = 2
    await rig.acquisition.abort('camera-id', 'mount-id')
    expect(rig.state.moves).toEqual([0])
    expect(rig.state.pendingStopReads).toBe(-1)
  })

  it('ends confirmation when the mount keeps reporting movement', async () => {
    const rig = observatory()
    rig.state.pendingStopReads = Infinity
    await expect(rig.acquisition.move('mount-id', 1, 0)).rejects.toThrow('within 5 seconds')
    expect(rig.state.moves).toEqual([1, 0])
  }, 8_000)

  it('stops motion after a lost start response without replaying movement', async () => {
    const rig = observatory()
    rig.state.lostMove = true
    await expect(rig.acquisition.move('mount-id', 1, 1)).rejects.toThrow()
    expect(rig.state.moves).toEqual([1, 0])
    expect(rig.state.rate).toBe(0)
  })

  it('stops an active movement after cancellation and reports an unconfirmed stop', async () => {
    const rig = observatory()
    const controller = new AbortController()
    const result = rig.acquisition.move('mount-id', 1, 10, controller.signal)
    const rejection = expect(result).rejects.toThrow()
    await vi.waitFor(() => expect(rig.state.rate).toBe(1))
    rig.state.stopFails = true
    controller.abort()
    await rejection
    expect(rig.state.moves).toEqual([1, 0])
    expect(rig.state.rate).toBe(1)
  })

  it('normalizes observer and pointing coordinates without disguising their reference frame', async () => {
    const rig = observatory()
    await expect(rig.acquisition.pointing('mount-id')).resolves.toEqual({
      rightAscensionDegrees: 30,
      declinationDegrees: 60,
      siderealTimeDegrees: 60,
      latitudeDegrees: 35,
      tracking: true,
      coordinateSystem: 'other',
    })
  })
})

describe('observed primary-axis rotation', () => {
  function pendingMotionResponse(phase: 'start' | 'read' | 'body') {
    const rig = observatory()
    let reachedPending!: () => void

    const pending = new Promise<void>(resolve => {
      reachedPending = resolve
    })

    let pendingSignal: AbortSignal | undefined

    const fetch: typeof globalThis.fetch = async (input, init) => {
      const response = await rig.fetch(input, init)
      const operation = new URL(String(input)).pathname.split('/').at(-1)

      const shouldHold =
        rig.state.rate !== 0 &&
        (phase === 'start' ? operation === 'moveaxis' : operation === 'rightascension')

      if (!shouldHold) return response
      const signal = init!.signal!
      pendingSignal = signal

      if (phase === 'body') {
        // Headers arrived, but the fetch-owned body is still in flight.
        return new Response(
          new ReadableStream({
            start(controller) {
              signal.addEventListener('abort', () => controller.error(signal.reason), {
                once: true,
              })
              reachedPending()
            },
          }),
        )
      }

      return new Promise<Response>((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        reachedPending()
      })
    }

    return {
      ...rig,
      pending,
      pendingSignal: () => pendingSignal,
      acquisition: createAlpacaAcquisition({ baseUrl: 'http://fake', fetch }),
    }
  }

  it.each(['start', 'read', 'body'] as const)(
    'aborts a pending %s response at the movement deadline and confirms one stop',
    async phase => {
      vi.useFakeTimers()

      try {
        const rig = pendingMotionResponse(phase)
        const result = rig.acquisition.rotateRightAscension('mount-id', 1.5, 0.15)
        const rejection = expect(result).rejects.toThrow('before timeout')
        await rig.pending
        expect(rig.state.moves).toEqual([1.5])
        await vi.advanceTimersByTimeAsync(2200)
        await rejection
        expect(rig.pendingSignal()?.aborted).toBe(true)
        expect(rig.state.moves).toEqual([1.5, 0])
        expect(rig.state.rate).toBe(0)
        expect(rig.state.pendingStopReads).toBe(-1)
      } finally {
        vi.useRealTimers()
      }
    },
  )

  it('cancels a pending RA body with the caller reason and confirms one stop', async () => {
    const rig = pendingMotionResponse('body')
    const controller = new AbortController()
    const reason = new Error('Operator cancelled alignment')
    const result = rig.acquisition.rotateRightAscension('mount-id', 1.5, 5, controller.signal)
    const rejection = expect(result).rejects.toBe(reason)
    await rig.pending
    controller.abort(reason)
    await rejection
    expect(rig.pendingSignal()?.aborted).toBe(true)
    expect(rig.state.moves).toEqual([1.5, 0])
    expect(rig.state.pendingStopReads).toBe(-1)
  })

  it('surfaces stop failure ahead of the movement deadline error', async () => {
    vi.useFakeTimers()

    try {
      const rig = pendingMotionResponse('read')
      const result = rig.acquisition.rotateRightAscension('mount-id', 1.5, 0.15)

      const rejection = expect(result).rejects.toMatchObject({
        reason: 'transport',
        endpoint: '/api/v1/telescope/3/moveaxis',
      })

      await rig.pending
      rig.state.stopFails = true
      await vi.advanceTimersByTimeAsync(2200)
      await rejection
      expect(rig.state.moves).toEqual([1.5, 0])
      expect(rig.state.rate).toBe(1.5)
    } finally {
      vi.useRealTimers()
    }
  })

  it.each(['elapsed', 'wall'] as const)(
    'uses elapsed time rather than wall-clock time when accepting a threshold response (%s clock jumps)',
    async clock => {
      vi.useFakeTimers()

      try {
        const rig = observatory()
        const monotonic = vi.spyOn(performance, 'now').mockReturnValue(0)

        const fetch: typeof globalThis.fetch = async (input, init) => {
          const response = await rig.fetch(input, init)

          if (rig.state.rate !== 0 && String(input).endsWith('/rightascension')) {
            // The sample exceeds the target. Model a late callback before its
            // expired timer has run, or an unrelated wall-clock correction.
            if (clock === 'elapsed') monotonic.mockReturnValue(3000)
            else vi.setSystemTime(Date.now() + 60_000)
          }

          return response
        }

        const acquisition = createAlpacaAcquisition({ baseUrl: 'http://fake', fetch })
        const result = acquisition.rotateRightAscension('mount-id', 1.5, 0.15)

        if (clock === 'elapsed') await expect(result).rejects.toThrow('before timeout')
        else await expect(result).resolves.toBeUndefined()
        expect(rig.state.moves).toEqual([1.5, 0])
        expect(rig.state.rate).toBe(0)
        monotonic.mockRestore()
      } finally {
        vi.useRealTimers()
      }
    },
  )

  it.each([1, -1])(
    'stops once requested RA travel is observed across wrap (direction %s)',
    async direction => {
      const rig = observatory()
      rig.state.raDegrees = direction > 0 ? 358 : 2
      await rig.acquisition.rotateRightAscension('mount-id', direction * 1.5, direction * 5)
      expect(rig.state.moves).toEqual([direction * 1.5, 0])
      expect(rig.state.rate).toBe(0)
      expect(rig.state.raDegrees).toBe(direction > 0 ? 4 : 356)
    },
  )

  it('stops and rejects opposite RA travel', async () => {
    const rig = observatory()
    await expect(rig.acquisition.rotateRightAscension('mount-id', 1.5, -5)).rejects.toThrow(
      'opposite direction',
    )
    expect(rig.state.moves).toEqual([1.5, 0])
  })

  it('stops when a live RA read fails without replaying movement', async () => {
    const rig = observatory()
    rig.state.raReadFails = true
    await expect(rig.acquisition.rotateRightAscension('mount-id', 1.5, 5)).rejects.toThrow()
    expect(rig.state.moves).toEqual([1.5, 0])
  })

  it('stops an accepted move whose response was lost', async () => {
    const rig = observatory()
    rig.state.lostMove = true
    await expect(rig.acquisition.rotateRightAscension('mount-id', 1.5, 5)).rejects.toThrow()
    expect(rig.state.moves).toEqual([1.5, 0])
  })

  it('cancels an observed rotation and confirms its stop', async () => {
    const rig = observatory()
    rig.state.raStep = 0
    rig.state.pendingStopReads = 2
    const controller = new AbortController()
    const result = rig.acquisition.rotateRightAscension('mount-id', 1.5, 5, controller.signal)
    const rejection = expect(result).rejects.toThrow()
    await vi.waitFor(() => expect(rig.state.moves).toEqual([1.5]))
    controller.abort()
    await rejection
    expect(rig.state.moves).toEqual([1.5, 0])
    expect(rig.state.pendingStopReads).toBeLessThan(0)
  })

  it('bounds a rotation with no progress and stops it', async () => {
    vi.useFakeTimers()

    try {
      const rig = observatory()
      rig.state.raStep = 0
      const result = rig.acquisition.rotateRightAscension('mount-id', 1.5, 0.01)
      const rejection = expect(result).rejects.toThrow('timeout')
      await vi.advanceTimersByTimeAsync(3000)
      await rejection
      expect(rig.state.moves).toEqual([1.5, 0])
    } finally {
      vi.useRealTimers()
    }
  })
})
