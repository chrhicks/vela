import { describe, expect, it, vi } from 'vitest'
import { createAlpacaAcquisition, AlpacaCaptureStoppedError } from './acquisition.js'

function observatory() {
  const camera = { DeviceName: 'Camera', DeviceType: 'Camera', DeviceNumber: 7, UniqueID: 'camera-id' }
  const telescope = { DeviceName: 'Mount', DeviceType: 'Telescope', DeviceNumber: 3, UniqueID: 'mount-id' }
  const state = {
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
    imageBinary: null as ArrayBuffer | null,
    image: { Type: 2, Rank: 2, Value: [[1, 3], [2, 4]] } as Record<string, unknown>,
    stamp: '2026-09-05T01:00:00',
    stampError: 0,
    imageReads: 0,
    pendingReadyReads: 0,
    stale: false,
    starts: 0,
    moves: [] as number[],
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
    let Value: unknown
    if (operation === 'configureddevices') Value = [camera, telescope]
    else if (operation === 'connected' || operation === 'canabortexposure' || operation === 'canmoveaxis' || operation === 'tracking') Value = true
    else if (operation === 'name') Value = state.cameraName
    else if (operation === 'axisrates') Value = [{ Minimum: 0, Maximum: 1.5 }]
    else if (operation === 'sensortype') Value = state.sensorType
    else if (operation === 'binx') Value = state.binX
    else if (operation === 'biny') Value = state.binY
    else if (operation === 'bayeroffsetx' || operation === 'bayeroffsety') {
      if (state.unsupportedOffset) return Response.json({ ClientTransactionID: 0, ServerTransactionID: 1, ErrorNumber: 1024, ErrorMessage: 'Not implemented' })
      Value = operation === 'bayeroffsetx' ? state.offsetX : state.offsetY
    }
    else if (operation === 'startx') Value = state.startX
    else if (operation === 'starty') Value = state.startY
    else if (operation === 'numx' || operation === 'numy') Value = 2
    else if (operation === 'camerastate') Value = state.exposing ? 2 : 0
    else if (operation === 'imageready') {
      Value = state.ready
      if (state.starts > 0 && !state.ready) state.pendingReadyReads++
    }
    else if (operation === 'slewing') {
      Value = state.rate !== 0 || (state.stopping && state.pendingStopReads-- > 0)
    }
    else if (operation === 'lastexposurestarttime') {
      if (state.stampError) return Response.json({ ClientTransactionID: 0, ServerTransactionID: 1, ErrorNumber: state.stampError, ErrorMessage: 'Timestamp unavailable' })
      Value = state.stamp
    }
    else if (operation === 'rightascension') Value = 2
    else if (operation === 'declination') Value = 60
    else if (operation === 'sitelatitude') Value = 35
    else if (operation === 'siderealtime') Value = 4
    else if (operation === 'equatorialsystem') Value = 0
    else if (operation === 'startexposure') {
      state.starts++
      if (!state.stale) { state.ready = false; state.exposing = true }
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
      if (state.imageBinary) return new Response(state.imageBinary, { headers: { 'content-type': 'application/imagebytes' } })
      return Response.json({ ClientTransactionID: 0, ServerTransactionID: 1, ErrorNumber: 0, ErrorMessage: '', ...state.image })
    } else throw new Error(`Unexpected request ${url.pathname}`)
    return Response.json({ ClientTransactionID: 0, ServerTransactionID: 1, ErrorNumber: 0, ErrorMessage: '', Value })
  }
  return {
    state,
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
  it('waits for a new completed exposure and transposes x/y wire pixels into row-major pixels', async () => {
    const rig = observatory()
    let resolved = false
    const result = rig.acquisition.capture({ cameraId: 'camera-id', expectedCameraName: 'Camera', exposureSeconds: 1 }).then(frame => { resolved = true; return frame })
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

  it.each(['Different camera', ''])('rejects a changed or missing operational camera identity before exposure: %j', async cameraName => {
    const rig = observatory()
    rig.state.cameraName = cameraName
    await expect(rig.acquisition.capture({ cameraId: 'camera-id', expectedCameraName: 'Camera', exposureSeconds: 1 })).rejects.toThrow()
    expect(rig.state.starts).toBe(0)
    expect(rig.state.aborts).toBe(0)
  })

  it.each([
    { offsetX: 0, offsetY: 0, startX: 0, startY: 0, pattern: 'rggb' },
    { offsetX: 1, offsetY: 0, startX: 0, startY: 0, pattern: 'grbg' },
    { offsetX: 0, offsetY: 1, startX: 0, startY: 0, pattern: 'gbrg' },
    { offsetX: 1, offsetY: 1, startX: 0, startY: 0, pattern: 'bggr' },
    { offsetX: 0, offsetY: 0, startX: 3, startY: 5, pattern: 'bggr' },
    { offsetX: 1, offsetY: 1, startX: 3, startY: 5, pattern: 'rggb' },
    { offsetX: 1, offsetY: 0, startX: 3, startY: 4, pattern: 'rggb' },
  ])('normalizes Bayer phase for sensor offsets and subframe origin: %j', async ({ pattern, ...settings }) => {
    const rig = observatory()
    Object.assign(rig.state, settings, { sensorType: 2 })
    const result = rig.acquisition.capture({ cameraId: 'camera-id', exposureSeconds: 1 })
    await started(rig)
    rig.complete()
    const frame = await result
    expect(frame.color).toEqual({ kind: 'bayer', pattern })
    expect(Array.from(frame.pixels)).toEqual([1, 2, 3, 4])
  })

  it.each([
    { sensorType: 1 }, { sensorType: 3 }, { sensorType: 4 }, { sensorType: 5 },
    { sensorType: -1 }, { sensorType: 1.5 },
    { binX: 2 }, { binY: 2 }, { binX: 0 }, { binY: 1.5 },
    { offsetX: 2 }, { offsetY: -1 }, { offsetX: 0.5 },
    { startX: -1 }, { startY: 0.5 }, { startX: 2147483648 },
    { unsupportedOffset: true },
  ])('rejects unsupported or malformed color interpretation before starting: %j', async settings => {
    const rig = observatory()
    Object.assign(rig.state, { sensorType: 2 }, settings)
    await expect(rig.acquisition.capture({ cameraId: 'camera-id', exposureSeconds: 1 })).rejects.toThrow()
    expect(rig.state.starts).toBe(0)
    expect(rig.state.aborts).toBe(0)
  })

  it('preserves the pre-exposure restriction for a monochrome-only consumer', async () => {
    const rig = observatory()
    rig.state.sensorType = 2
    await expect(rig.acquisition.capture({ cameraId: 'camera-id', exposureSeconds: 1, monochromeOnly: true })).rejects.toThrow('requires a monochrome camera')
    expect(rig.state.starts).toBe(0)
    expect(rig.state.aborts).toBe(0)
  })

  it.each([
    { Type: 2, Rank: 3, Value: [[[1]]] },
    { Type: 2, Rank: 2, Value: [[1, 2], [3]] },
    { Type: 2, Rank: 2, Value: [[1, 2], [3, 2 ** 32]] },
    { Type: 3, Rank: 2, Value: [[1, 2], [3, 4]] },
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
    await expect(rig.acquisition.capture({ cameraId: 'camera-id', exposureSeconds: 1 })).rejects.toThrow('freshness is unconfirmed')
  })

  it.each([0, 1024])('estimates start time only after a fresh ready transition when the timestamp is blank or unsupported (%i)', async stampError => {
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
  })

  it.each([0, 1024])('rejects retained-ready images without a usable timestamp (%i)', async stampError => {
    const rig = observatory()
    Object.assign(rig.state, { stamp: '', stampError, stale: true })
    await expect(rig.acquisition.capture({ cameraId: 'camera-id', exposureSeconds: 1 })).rejects.toThrow('freshness is unconfirmed')
    expect(rig.state.imageReads).toBe(0)
    expect(rig.state.starts).toBe(1)
    expect(rig.state.aborts).toBe(1)
  })

  it.each([{ stamp: 'not a timestamp', stampError: 0 }, { stamp: '', stampError: 1035 }])('does not hide malformed timestamps or other driver errors: %j', async timestamp => {
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
    await expect(rig.acquisition.capture({ cameraId: 'camera-id', exposureSeconds: 1 })).rejects.toThrow()
    expect(rig.state.starts).toBe(1)
    expect(rig.state.imageReads).toBe(0)
    expect(rig.state.aborts).toBe(1)
  })

  it('confirms cancellation before starting without aborting someone else’s exposure', async () => {
    const rig = observatory()
    rig.state.exposing = true
    const controller = new AbortController()
    controller.abort()
    await expect(rig.acquisition.capture({ cameraId: 'camera-id', exposureSeconds: 1, signal: controller.signal })).rejects.toBeInstanceOf(AlpacaCaptureStoppedError)
    expect(rig.state.starts).toBe(0)
    expect(rig.state.aborts).toBe(0)
    expect(rig.state.exposing).toBe(true)
  })

  it('aborts a pending exposure with an independent signal after cancellation', async () => {
    const rig = observatory()
    const controller = new AbortController()
    const result = rig.acquisition.capture({ cameraId: 'camera-id', exposureSeconds: 1, signal: controller.signal })
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
    const result = rig.acquisition.capture({ cameraId: 'camera-id', exposureSeconds: 1, signal: controller.signal })
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
    await expect(rig.acquisition.capture({ cameraId: 'camera-id', exposureSeconds: 1 })).rejects.toThrow()
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
      rightAscensionDegrees: 30, declinationDegrees: 60, siderealTimeDegrees: 60,
      latitudeDegrees: 35, tracking: true, coordinateSystem: 'other',
    })
  })
})
