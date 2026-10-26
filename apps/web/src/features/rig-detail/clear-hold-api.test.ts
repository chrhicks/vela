import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearHold } from './clear-hold-api'

afterEach(() => vi.unstubAllGlobals())

function reply(status: number, body: Readonly<Record<string, string>>) {
  return vi.fn(async (_url: string, _init: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )
}

describe('clearHold', () => {
  it('confirms the recovery with a generated note for the encoded device id', async () => {
    const fetch = reply(200, { outcome: 'confirmed', found: 'Cria recovered ZWO AM5' })

    vi.stubGlobal('fetch', fetch)

    expect(await clearHold('rig-1', 'cria:rig-1:mount', new Date('2026-10-26T20:00:00Z'))).toEqual({ kind: 'cleared' })
    const [url, init] = fetch.mock.calls[0] ?? []

    expect(url).toBe('/api/rigs/rig-1/devices/cria%3Arig-1%3Amount/recover')
    expect(JSON.parse(String(init?.body))).toEqual({
      externalRecoveryConfirmed: true,
      note: 'Cleared from the Vela page by the operator at 2026-10-26T20:00:00.000Z',
    })
  })

  it('tells a busy device from any other refusal', async () => {
    vi.stubGlobal('fetch', reply(409, { error: 'device-busy', reason: 'An operation is open' }))
    expect(await clearHold('rig-1', 'mount')).toEqual({ kind: 'busy' })

    vi.stubGlobal('fetch', reply(409, { error: 'recovery-failed', reason: 'This hold has changed.' }))
    expect(await clearHold('rig-1', 'mount')).toEqual({ kind: 'failed', message: 'This hold has changed.' })
  })

  it('does not claim the hold is still there or gone when no answer came back', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('network down'))))

    expect(await clearHold('rig-1', 'mount')).toEqual({
      kind: 'failed',
      message: 'Vela did not hear back, so the hold may or may not be cleared. The page shows which.',
    })
  })
})
