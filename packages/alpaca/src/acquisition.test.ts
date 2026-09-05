import { describe, expect, it, vi } from 'vitest'
import { createAlpacaAcquisition } from './acquisition.js'

function observatory() {
  const camera = { DeviceName: 'Camera', DeviceType: 'Camera', DeviceNumber: 7, UniqueID: 'camera-id' }
  const telescope = { DeviceName: 'Mount', DeviceType: 'Telescope', DeviceNumber: 3, UniqueID: 'mount-id' }
  const state = {
    ready: true,
    exposing: false,
    rate: 0,
    image: { Type: 2, Rank: 2, Value: [[1, 3], [2, 4]] } as Record<string, unknown>,
    stamp: '2026-09-05T01:00:00',
    stale: false,
    starts: 0,
    moves: [] as number[],
    aborts: 0,
    lostStart: false,
    lostMove: false,
    stopFails: false,
  }
  const fetch: typeof globalThis.fetch = async (input, init) => {
    init?.signal?.throwIfAborted()
    const url = new URL(String(input))
    const operation = url.pathname.split('/').at(-1)
    const parameters = new URLSearchParams(String(init?.body ?? ''))
    let Value: unknown
    if (operation === 'configureddevices') Value = [camera, telescope]
    else if (operation === 'connected' || operation === 'canabortexposure' || operation === 'canmoveaxis' || operation === 'tracking') Value = true
    else if (operation === 'axisrates') Value = [{ Minimum: 0, Maximum: 1.5 }]
    else if (operation === 'sensortype') Value = 0
    else if (operation === 'numx' || operation === 'numy') Value = 2
    else if (operation === 'camerastate') Value = state.exposing ? 2 : 0
    else if (operation === 'imageready') Value = state.ready
    else if (operation === 'slewing') Value = state.rate !== 0
    else if (operation === 'lastexposurestarttime') Value = state.stamp
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
      state.exposing = false
      state.ready = false
    } else if (operation === 'moveaxis') {
      const rate = Number(parameters.get('Rate'))
      state.moves.push(rate)
      if (rate === 0 && state.stopFails) throw new TypeError('Cannot reach mount to stop it')
      state.rate = rate
      if (rate !== 0 && state.lostMove) throw new TypeError('Response lost after motion began')
    } else if (operation === 'imagearray') {
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
    const result = rig.acquisition.capture({ cameraId: 'camera-id', exposureSeconds: 1 }).then(frame => { resolved = true; return frame })
    await started(rig)
    expect(resolved).toBe(false)
    rig.complete()
    const frame = await result
    expect(Array.from(frame.pixels)).toEqual([1, 2, 3, 4])
    expect(frame.capturedAt).toBe('2026-09-05T01:00:02Z')
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

  it('aborts a pending exposure with an independent signal after cancellation', async () => {
    const rig = observatory()
    const controller = new AbortController()
    const result = rig.acquisition.capture({ cameraId: 'camera-id', exposureSeconds: 1, signal: controller.signal })
    const rejection = expect(result).rejects.toThrow()
    await started(rig)
    controller.abort()
    await rejection
    expect(rig.state.aborts).toBe(1)
    expect(rig.state.exposing).toBe(false)
  })

  it('does not replay an exposure whose command response was lost', async () => {
    const rig = observatory()
    rig.state.lostStart = true
    await expect(rig.acquisition.capture({ cameraId: 'camera-id', exposureSeconds: 1 })).rejects.toThrow()
    expect(rig.state.starts).toBe(1)
    expect(rig.state.aborts).toBe(1)
    expect(rig.state.exposing).toBe(false)
  })

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
