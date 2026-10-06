import { describe, expect, it, vi } from 'vitest'
import type { ResponseFixture } from './internal/test-fixtures.js'
import { createAlpacaMountControl } from './mount-control.js'

function fixture(confirmationTimeoutMs = 20) {
  const state = {
    connected: true, name: 'Fixture Mount', atpark: false, tracking: false,
    slewing: false, canunpark: true, cansettracking: true,
  }

  const writes: { path: string; body: URLSearchParams }[] = []
  const faults = { dropped: false, rejected: false, unchanged: false, unknownMotion: false, changedIdentity: false, asynchronous: false }

  const fetch: typeof globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname
    const property = path.split('/').at(-1)!

    const envelope = (Value: ResponseFixture, ErrorNumber = 0) => Response.json({ Value, ErrorNumber,
      ErrorMessage: ErrorNumber ? 'Driver rejected request' : '', ClientTransactionID: 0, ServerTransactionID: 1 })

    if (path === '/management/v1/configureddevices') return envelope([{
      DeviceName: 'Fixture Mount', DeviceType: 'Telescope', DeviceNumber: 2, UniqueID: 'mount',
    }])

    if (init?.method === 'PUT') {
      const body = init.body instanceof URLSearchParams ? init.body : new URLSearchParams()
      writes.push({ path, body })

      if (faults.rejected) return envelope(null, 1025)

      if (!faults.unchanged) {
        if (property === 'unpark') {
          state.atpark = false
          state.slewing = faults.asynchronous
        }

        if (property === 'tracking') state.tracking = body.get('Tracking') === 'true'
      }

      if (faults.changedIdentity) state.name = 'Replacement mount'

      if (faults.dropped) throw new TypeError('Write response lost')

      return envelope(null)
    }

    if (property === 'slewing' && faults.unknownMotion) return envelope(null, 1024)

    if (!(property in state)) throw new Error(`Unexpected request ${path}`)

    return envelope(Object.entries(state).find(([key]) => key === property)![1])
  }

  const control = createAlpacaMountControl({ baseUrl: 'http://alpaca.test', fetch,
    pollIntervalMs: 1, confirmationTimeoutMs })

  return { state, faults, writes, control }
}

const trackingOn = { telescopeId: 'mount', expectedTelescopeName: 'Fixture Mount', kind: 'set-tracking', tracking: true } as const

describe('Alpaca mount preparation controls', () => {
  it('uses the telescope tracking setter once and confirms its readback', async () => {
    const f = fixture()
    expect(await f.control.execute(trackingOn)).toMatchObject({ outcome: 'confirmed', observation: { tracking: true, parked: false } })
    expect(f.writes).toHaveLength(1)
    expect(f.writes[0]?.path).toBe('/api/v1/telescope/2/tracking')
    expect(f.writes[0]?.body.get('Tracking')).toBe('true')
    expect(await f.control.execute(trackingOn)).toMatchObject({ outcome: 'confirmed' })
    expect(f.writes).toHaveLength(1)
  })

  it('unparks with no tracking setter and confirms stopped, unparked readback', async () => {
    const f = fixture()
    f.state.atpark = true
    expect(await f.control.execute({ telescopeId: 'mount', kind: 'unpark' })).toMatchObject({ outcome: 'confirmed', observation: { parked: false, tracking: false } })
    expect(f.writes.map(write => write.path)).toEqual(['/api/v1/telescope/2/unpark'])
    expect(f.writes[0]?.body.has('Tracking')).toBe(false)
  })

  it('waits for asynchronous unpark completion and reads the driver-selected tracking state', async () => {
    const f = fixture(1_000)
    f.state.atpark = true
    f.faults.asynchronous = true
    let completed = false

    const pending = f.control.execute({ telescopeId: 'mount', kind: 'unpark' }).then(result => {
      completed = true

      return result
    })

    await vi.waitFor(() => expect(f.writes).toHaveLength(1))
    expect(completed).toBe(false)
    f.state.tracking = true
    f.state.slewing = false
    expect(await pending).toMatchObject({ outcome: 'confirmed', observation: { parked: false, tracking: true, slewing: false } })
    expect(f.writes).toHaveLength(1)
  })

  it('rejects parked tracking-on, moving, unknown motion, unsupported and changed identity before writes', async () => {
    const f = fixture()
    f.state.atpark = true
    expect(await f.control.execute(trackingOn)).toMatchObject({ outcome: 'failed', reason: 'parked' })
    f.state.atpark = false
    f.state.slewing = true
    expect(await f.control.execute(trackingOn)).toMatchObject({ outcome: 'failed', reason: 'busy' })
    f.state.slewing = false
    f.faults.unknownMotion = true
    expect((await f.control.observe('mount'))?.slewing).toBeUndefined()
    expect(await f.control.execute(trackingOn)).toMatchObject({ outcome: 'failed', reason: 'unavailable' })
    f.faults.unknownMotion = false
    f.state.cansettracking = false
    expect(await f.control.execute(trackingOn)).toMatchObject({ outcome: 'failed', reason: 'unsupported' })
    f.state.cansettracking = true
    f.state.name = 'Replacement mount'
    expect(await f.control.execute(trackingOn)).toMatchObject({ outcome: 'failed', reason: 'unavailable' })
    expect(f.writes).toHaveLength(0)
  })

  it('reconciles a lost write response without replay; disagreement remains uncertain', async () => {
    const f = fixture()
    f.faults.dropped = true
    expect(await f.control.execute(trackingOn)).toMatchObject({ outcome: 'confirmed' })
    expect(f.writes).toHaveLength(1)
    const unchanged = fixture()
    unchanged.faults.dropped = true
    unchanged.faults.unchanged = true
    expect(await unchanged.control.execute(trackingOn)).toMatchObject({ outcome: 'uncertain', reason: 'write-outcome-unknown' })
    expect(unchanged.writes).toHaveLength(1)
  })

  it('preserves a driver rejection and refuses readback from replacement hardware', async () => {
    const rejected = fixture()
    rejected.faults.rejected = true
    expect(await rejected.control.execute(trackingOn)).toMatchObject({ outcome: 'failed', reason: 'rejected', message: expect.stringContaining('Driver rejected') })
    const replaced = fixture()
    replaced.faults.changedIdentity = true
    expect(await replaced.control.execute(trackingOn)).toMatchObject({ outcome: 'uncertain', reason: 'verification-unavailable' })
    expect(replaced.writes).toHaveLength(1)
  })
})
