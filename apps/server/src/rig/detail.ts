import {
  AlpacaProviderError,
  type AlpacaDeviceInspection,
} from '@vela/alpaca'
import type { RigState } from '@vela/model/rig'
import type { RigDetailView, RigDeviceDetailView } from '@vela/model/web'
import {
  createRigDeviceInspector,
  type RigDeviceInspector,
  type RigInspectionSource,
} from '../device/inspection.js'
import { summarizeDeviceConnections } from '../web/device.js'
import {
  currentDeviceView,
  unavailableDeviceView,
} from '../web/rig-detail.js'
import type { RigCatalog } from './catalog.js'
import type {
  ObservedDeviceRecord,
  ObservedRigInventory,
  RigCatalogRecord,
} from './contracts.js'

export type LoadRigDetailResult =
  | { readonly state: 'found'; readonly view: RigDetailView }
  | { readonly state: 'not-found' }

export type InspectRigDetailResult =
  | {
      readonly state: 'current'
      readonly view: RigDetailView
      readonly inspections: ReadonlyArray<AlpacaDeviceInspection>
    }
  | {
      readonly state: 'unavailable'
      readonly reason: 'needs-attention' | 'offline'
      readonly view: RigDetailView
    }
  | { readonly state: 'conflict'; readonly view: RigDetailView }
  | { readonly state: 'not-found' }

export interface RigDetailOptions {
  readonly createInspector?: (rig: RigInspectionSource) => RigDeviceInspector
  readonly now?: () => Date
  readonly onUnavailable?: (
    rig: RigCatalogRecord,
    state: Exclude<RigState, 'reachable'>,
    cause: AlpacaProviderError,
  ) => void
  readonly onConflict?: (rig: RigCatalogRecord) => void
  readonly signal?: AbortSignal
}

export async function inspectRigDetail(
  catalog: RigCatalog,
  rigId: string,
  {
    createInspector = createRigDeviceInspector,
    now = () => new Date(),
    onUnavailable = () => {},
    onConflict = () => {},
    signal,
  }: RigDetailOptions = {},
): Promise<InspectRigDetailResult> {
  const record = await catalog.get(rigId)

  if (record === undefined) return { state: 'not-found' }

  let inspections: ReadonlyArray<AlpacaDeviceInspection>

  try {
    inspections = await createInspector(record).inspectDevices(
      signal === undefined ? undefined : { signal },
    )
  } catch (error) {
    if (signal?.aborted) throw error

    if (!(error instanceof AlpacaProviderError)) throw error

    const state = error.reason === 'transport' ? 'offline' : 'needs-attention'
    onUnavailable(record, state, error)

    return {
      state: 'unavailable',
      reason: state,
      view: lastKnownRigDetail(record, state, now().toISOString()),
    }
  }

  const refreshedAt = now().toISOString()
  const inventory = observedInventory(inspections, refreshedAt)
  const match = await catalog.observe(record.endpoint, inventory)

  if (match.state !== 'known' || match.rigId !== record.id) {
    onConflict(record)

    return {
      state: 'conflict',
      view: lastKnownRigDetail(record, 'needs-attention', refreshedAt),
    }
  }

  const devices = inspections.map((inspection) =>
    currentDeviceView(record.id, inspection, refreshedAt))

  return {
    state: 'current',
    inspections,
    view: {
      id: record.id,
      name: record.name,
      state: resolvedRigState(devices),
      endpoint: { ...record.endpoint },
      addedAt: record.addedAt,
      lastInventoryAt: refreshedAt,
      refreshedAt,
      connections: summarizeDeviceConnections(devices),
      devices,
      capabilities: ['forget'],
    },
  }
}

export async function loadRigDetailView(
  catalog: RigCatalog,
  rigId: string,
  options: RigDetailOptions = {},
): Promise<LoadRigDetailResult> {
  const result = await inspectRigDetail(catalog, rigId, options)

  return result.state === 'not-found'
    ? result
    : { state: 'found', view: result.view }
}

function resolvedRigState(devices: ReadonlyArray<RigDeviceDetailView>): RigState {
  const hasDeviceError = devices.some((device) =>
    device.kind === 'camera'
      && (device.status.availability === 'complete'
        || device.status.availability === 'partial')
      && device.status.activity === 'error')

  return hasDeviceError ? 'needs-attention' : 'reachable'
}

function observedInventory(
  inspections: ReadonlyArray<AlpacaDeviceInspection>,
  observedAt: string,
): ObservedRigInventory {
  return {
    observedAt,
    devices: inspections.map((inspection): ObservedDeviceRecord => ({
      uniqueId: inspection.providerDeviceId,
      kind: inspection.kind,
      name: inspection.configuredName,
    })),
  }
}

function lastKnownRigDetail(
  record: RigCatalogRecord,
  state: Exclude<RigState, 'reachable'>,
  refreshedAt: string,
): RigDetailView {
  const devices = record.lastObservedInventory.devices.map((device) =>
    unavailableDeviceView(record.id, device))

  return {
    id: record.id,
    name: record.name,
    state,
    endpoint: { ...record.endpoint },
    addedAt: record.addedAt,
    lastInventoryAt: record.lastObservedInventory.observedAt,
    refreshedAt,
    connections: summarizeDeviceConnections(devices),
    devices,
    capabilities: ['forget'],
  }
}
