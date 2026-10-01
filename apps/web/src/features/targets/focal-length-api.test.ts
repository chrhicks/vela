import type { FramingView } from '@vela/model/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFocalLengthSettings, saveFocalLengthSettings } from './focal-length-api'

const signal = new AbortController().signal

function framing(overrides: Partial<FramingView> = {}): FramingView {
  return {
    rigId: 'rig',
    rigName: 'Test rig',
    enabled: false,
    unavailableReason: 'Choose an imaging camera.',
    observedAt: new Date().toISOString(),
    focalLengthMm: 400,
    camera: null,
    phase: 'idle',
    active: false,
    captureReadState: 'current',
    desired: null,
    targetId: null,
    preview: null,
    actual: null,
    error: null,
    exposureSeconds: 2,
    canCenter: false,
    checkCurrent: false,
    pointingSide: 'unknown',
    centering: null,
    ...overrides,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('focal-length configuration boundary', () => {
  it('reads saved configuration even when framing is unavailable', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(framing()))
    vi.stubGlobal('fetch', fetch)

    expect(await readFocalLengthSettings('rig', signal)).toMatchObject({
      rigId: 'rig', focalLengthMm: 400, active: false,
    })
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/web/rigs/rig/framing')
  })

  it.each([NaN, Infinity, -Infinity, 9, 20001])('rejects %s without writing', async value => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    expect(await saveFocalLengthSettings('rig', value, signal)).toMatchObject({ status: 'rejected' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([10, 400, 20000])('confirms the requested %s mm returned by the server', async value => {
    const fetch = vi.fn().mockResolvedValue(Response.json(framing({ focalLengthMm: value })))
    vi.stubGlobal('fetch', fetch)

    expect(await saveFocalLengthSettings('rig', value, signal)).toMatchObject({
      status: 'confirmed', view: { focalLengthMm: value },
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]).toMatchObject([
      '/api/rigs/rig/framing/settings',
      { method: 'PUT', body: JSON.stringify({ focalLengthMm: value }) },
    ])
  })

  it.each([400, 404, 409])('distinguishes explicit %s rejection', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'Rejected' }, { status })))
    expect(await saveFocalLengthSettings('rig', 400, signal)).toMatchObject({ status: 'rejected' })
  })

  it.each([
    { focalLengthMm: 500 },
    { rigId: 'another-rig' },
    { observedAt: '2020-01-01T00:00:00.000Z' },
  ])('does not confirm a different or stale response: %j', async overrides => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(framing(overrides))))

    expect(await saveFocalLengthSettings('rig', 400, signal)).toMatchObject({ status: 'unconfirmed' })
  })

  it('does not replay a lost response or mistake a server failure for rejection', async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('Network error'))
      .mockResolvedValueOnce(Response.json({ error: 'Failed' }, { status: 500 }))
      .mockResolvedValueOnce(Response.json({ rigId: 'rig', focalLengthMm: 400 }))

    vi.stubGlobal('fetch', fetch)

    for (let attempt = 1; attempt <= 3; attempt++) {
      expect(await saveFocalLengthSettings('rig', 400, signal)).toMatchObject({ status: 'unconfirmed' })
      expect(fetch).toHaveBeenCalledTimes(attempt)
    }
  })
})
