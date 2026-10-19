import { describe, expect, it, vi } from 'vitest'
import type { Acquisition, Framing, Pointing, TelescopeStatus } from '@vela/equipment'
import { createMemoryRigCatalog } from '../rig/catalog.js'
import type { RigCatalogRecord } from '../rig/contracts.js'
import { mountReaderFor } from './mount.js'

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
    pierSide: 'west',
    observedAt: '2026-10-18T03:00:00Z',
    ...overrides,
  }
}

function unused(): never {
  throw new Error('The alert mount reader should not call this')
}

function reader(options: { rig?: RigCatalogRecord; status?: TelescopeStatus } = {}) {
  const telescopeStatus = vi.fn(async () => options.status ?? status())

  const pointing = vi.fn(async (): Promise<Pointing> => ({
    rightAscensionDegrees: 30,
    declinationDegrees: 42,
    siderealTimeDegrees: 15,
    latitudeDegrees: 40,
    tracking: true,
    coordinateSystem: 'topocentric',
  }))

  const framing: Framing = {
    telescopeStatus,
    cameraGeometry: unused,
    setTracking: unused,
    slew: unused,
    home: unused,
    abortTelescope: unused,
  }

  const acquisition: Acquisition = {
    pointing,
    capture: unused,
    move: unused,
    rotateRightAscension: unused,
    abort: unused,
  }

  const read = mountReaderFor('fra', createMemoryRigCatalog([options.rig ?? rig]), {
    createFraming: () => framing,
    createAcquisition: () => acquisition,
  })

  return { read, telescopeStatus, pointing }
}

const signal = new AbortController().signal

describe('reading a Cria rig mount for the alert rules', () => {
  it('combines the mount flags, right ascension and pier side with the sidereal time, in hours', async () => {
    const { read, telescopeStatus } = reader()

    expect(await read(signal)).toEqual({
      tracking: true,
      slewing: false,
      parked: false,
      rightAscensionHours: 2,
      siderealTimeHours: 1,
      pierSide: 'west',
    })

    expect(telescopeStatus).toHaveBeenCalledWith(mount.uniqueId, signal, { includePointingSide: true })
  })

  it('leaves right ascension out when it is not topocentric, because the hour angle would be wrong', async () => {
    const { read } = reader({ status: status({ coordinateSystem: 'j2000' }) })

    expect(await read(signal)).toMatchObject({ rightAscensionHours: null })
  })

  it('does not know a pier side the mount cannot give', async () => {
    const { read } = reader({ status: status({ pierSide: 'unknown' }) })

    expect(await read(signal)).toMatchObject({ pierSide: null })
  })

  it('reads nothing from an Alpaca rig or a rig without exactly one telescope', async () => {
    const { source: _, ...alpaca } = rig

    const none = reader({ rig: alpaca })
    expect(await none.read(signal)).toBeNull()

    const two = reader({ rig: { ...rig, lastObservedInventory: { ...rig.lastObservedInventory, devices: [mount, { ...mount, uniqueId: 'other' }] } } })
    expect(await two.read(signal)).toBeNull()
    expect(two.telescopeStatus).not.toHaveBeenCalled()
  })

  it('lets a failed read through so the monitor can call the rig unreachable', async () => {
    const { read, telescopeStatus } = reader()
    telescopeStatus.mockRejectedValueOnce(new Error('timed out'))

    await expect(read(signal)).rejects.toThrow('timed out')
  })
})
