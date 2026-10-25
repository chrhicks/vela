import { describe, expect, it, vi } from 'vitest'
import type { Focuser } from '@vela/equipment'
import { createMemoryRigCatalog } from '../rig/catalog.js'
import type { RigCatalogRecord } from '../rig/contracts.js'
import { focuserReaderFor } from './focuser.js'

const focuser = { uniqueId: 'cria:fra:focuser', kind: 'focuser' as const, name: 'EAF' }

const rig: RigCatalogRecord = {
  id: 'fra',
  name: 'FRA 400',
  endpoint: { host: 'cria.local', port: 80 },
  source: { kind: 'cria' as const, configurationId: 'fra' },
  addedAt: '2026-09-01T20:00:00.000Z',
  lastObservedInventory: { observedAt: '2026-09-01T20:00:00.000Z', devices: [focuser] },
}

function reader(record: RigCatalogRecord = rig) {
  const status = vi.fn(async () => ({ absolute: true, position: 12345, maxStep: 50000, moving: false }))
  const adapter: Focuser = { status, move: vi.fn(), halt: vi.fn() }
  const read = focuserReaderFor('fra', createMemoryRigCatalog([record]), { createFocuser: () => adapter })

  return { read, status }
}

const signal = new AbortController().signal

describe('reading a rig focuser position for the alert monitor', () => {
  it('reads the position of the one focuser the rig has', async () => {
    const { read, status } = reader()

    expect(await read(signal)).toBe(12345)
    expect(status).toHaveBeenCalledWith(focuser.uniqueId, signal)
  })

  it('reads nothing from a rig without exactly one focuser', async () => {
    const none = reader({ ...rig, lastObservedInventory: { ...rig.lastObservedInventory, devices: [] } })
    expect(await none.read(signal)).toBeNull()

    const two = reader({ ...rig, lastObservedInventory: { ...rig.lastObservedInventory, devices: [focuser, { ...focuser, uniqueId: 'other' }] } })
    expect(await two.read(signal)).toBeNull()
    expect(two.status).not.toHaveBeenCalled()
  })

  it('lets a failed read through for the monitor to skip', async () => {
    const { read, status } = reader()
    status.mockRejectedValueOnce(new Error('timed out'))

    await expect(read(signal)).rejects.toThrow('timed out')
  })
})
