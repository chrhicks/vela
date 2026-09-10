import type { RigView } from '@vela/model/rig'
import type { HomeView } from '@vela/model/web'
import {
  createRigDeviceInventory,
  type RigDeviceInventory,
  type RigInventorySource,
} from '../device/inventory.js'
import type { ObservedRigDevice } from '../device/model.js'
import { summarizeDeviceConnections } from '../web/device.js'
import type { RigCatalog } from './catalog.js'
import type { ObservedRigInventory, RigCatalogRecord } from './contracts.js'

interface HomeViewOptions {
  readonly createInventory?: (rig: RigInventorySource) => RigDeviceInventory
  readonly now?: () => Date
  readonly onConflict?: (rig: RigCatalogRecord) => void
  readonly onUnavailable?: (rig: RigCatalogRecord, cause: unknown) => void
}

export async function loadHomeView(
  catalog: RigCatalog,
  {
    createInventory = createRigDeviceInventory,
    now = () => new Date(),
    onConflict = () => {},
    onUnavailable = () => {},
  }: HomeViewOptions = {},
): Promise<HomeView> {
  const records = await catalog.list()

  const rigs = await Promise.all(records.map(async (record) => {
    let devices: ReadonlyArray<ObservedRigDevice>

    try {
      devices = await createInventory(record).listDevices()
    } catch (error) {
      onUnavailable(record, error)

      return lastKnownRig(record, 'unreachable')
    }

    const inventory = observedInventory(devices, now)
    const match = await catalog.observe(record.endpoint, inventory)

    if (match.state !== 'known' || match.rigId !== record.id) {
      onConflict(record)

      return lastKnownRig(record, 'unknown')
    }

    return reachableRig(record, devices, inventory.observedAt)
  }))

  return {
    rigs,
    refreshedAt: now().toISOString(),
  }
}

function observedInventory(
  devices: ReadonlyArray<ObservedRigDevice>,
  now: () => Date,
): ObservedRigInventory {
  return {
    observedAt: devices[0]?.observedAt.toISOString() ?? now().toISOString(),
    devices: devices.map((device) => ({
      uniqueId: device.uniqueId,
      kind: device.kind,
      name: device.name,
    })),
  }
}

function reachableRig(
  record: RigCatalogRecord,
  devices: ReadonlyArray<ObservedRigDevice>,
  lastSeenAt: string,
): RigView {
  return {
    id: record.id,
    name: record.name,
    reachability: 'reachable',
    lastSeenAt,
    connections: summarizeDeviceConnections(devices),
    capabilities: ['forget'],
  }
}

function lastKnownRig(
  record: RigCatalogRecord,
  reachability: 'unreachable' | 'unknown',
): RigView {
  return {
    id: record.id,
    name: record.name,
    reachability,
    lastSeenAt: record.lastObservedInventory.observedAt,
    connections: {
      total: record.lastObservedInventory.devices.length,
      connected: 0,
      disconnected: 0,
      unavailable: record.lastObservedInventory.devices.length,
    },
    capabilities: ['forget'],
  }
}
