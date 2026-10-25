import { describe, expect, it, vi } from 'vitest'
import type { Framing, TelescopeStatus } from '@vela/equipment'
import { createMemoryRigCatalog } from '../rig/catalog.js'
import type { RigCatalogRecord } from '../rig/contracts.js'
import { siteReaderFor } from './site.js'

const mount = { uniqueId: 'cria:fra:mount', kind: 'telescope' as const, name: 'AM5' }

const rig: RigCatalogRecord = {
  id: 'fra',
  name: 'FRA 400',
  endpoint: { host: 'cria.local', port: 80 },
  source: { kind: 'cria' as const, configurationId: 'fra' },
  addedAt: '2026-09-01T20:00:00.000Z',
  lastObservedInventory: { observedAt: '2026-09-01T20:00:00.000Z', devices: [mount] },
}

function status(overrides: Partial<TelescopeStatus> = {}): TelescopeStatus {
  return {
    rightAscensionDegrees: 30,
    declinationDegrees: 42,
    coordinateSystem: 'topocentric',
    tracking: true,
    slewing: false,
    parked: false,
    observedAt: '2026-10-18T03:00:00Z',
    latitudeDegrees: 51.4769,
    longitudeDegrees: -0.0005,
    ...overrides,
  }
}

function unused(): never {
  throw new Error('The alert site reader should not call this')
}

function reader(options: { rig?: RigCatalogRecord; status?: TelescopeStatus } = {}) {
  const telescopeStatus = vi.fn(async () => options.status ?? status())

  const framing: Framing = {
    telescopeStatus,
    cameraGeometry: unused,
    setTracking: unused,
    slew: unused,
    home: unused,
    abortTelescope: unused,
  }

  const read = siteReaderFor('fra', createMemoryRigCatalog([options.rig ?? rig]), { createFraming: () => framing })

  return { read, telescopeStatus }
}

const signal = new AbortController().signal

describe('reading where a rig is from its mount', () => {
  it('uses the latitude and longitude the mount already reports', async () => {
    const { read, telescopeStatus } = reader()

    expect(await read(signal)).toEqual({ latitudeDegrees: 51.4769, longitudeDegrees: -0.0005 })
    expect(telescopeStatus).toHaveBeenCalledWith(mount.uniqueId, signal)
  })

  it('does not know the site when the mount gives no location', async () => {
    const { latitudeDegrees: _, longitudeDegrees: __, ...without } = status()
    const { longitudeDegrees: ___, ...withoutLongitude } = status()

    expect(await reader({ status: without }).read(signal)).toBeNull()
    expect(await reader({ status: withoutLongitude }).read(signal)).toBeNull()
  })

  it('does not trust 0 N 0 E, which a mount with no location set reports', async () => {
    expect(await reader({ status: status({ latitudeDegrees: 0, longitudeDegrees: 0 }) }).read(signal)).toBeNull()
    expect(await reader({ status: status({ latitudeDegrees: 0, longitudeDegrees: 18 }) }).read(signal)).toEqual({
      latitudeDegrees: 0,
      longitudeDegrees: 18,
    })
  })

  it('does not trust a location outside the globe', async () => {
    expect(await reader({ status: status({ latitudeDegrees: 91 }) }).read(signal)).toBeNull()
    expect(await reader({ status: status({ longitudeDegrees: 181 }) }).read(signal)).toBeNull()
    expect(await reader({ status: status({ latitudeDegrees: Number.NaN }) }).read(signal)).toBeNull()
  })

  it('asks nothing of a rig without exactly one telescope', async () => {
    const two = reader({ rig: { ...rig, lastObservedInventory: { ...rig.lastObservedInventory, devices: [mount, { ...mount, uniqueId: 'other' }] } } })

    expect(await two.read(signal)).toBeNull()
    expect(two.telescopeStatus).not.toHaveBeenCalled()
  })

  it('reads an Alpaca rig the same way', async () => {
    const { source: _, ...alpaca } = rig

    expect(await reader({ rig: alpaca }).read(signal)).toEqual({ latitudeDegrees: 51.4769, longitudeDegrees: -0.0005 })
  })

  it('lets a failed read through so the monitor can try again', async () => {
    const { read, telescopeStatus } = reader()
    telescopeStatus.mockRejectedValueOnce(new Error('timed out'))

    await expect(read(signal)).rejects.toThrow('timed out')
  })
})
