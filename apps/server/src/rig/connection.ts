import {
  AlpacaProviderError,
  type AlpacaDeviceConnectionResult,
} from '@vela/alpaca'
import type {
  ConnectRigDevicesResult,
  RigConnectionDeviceView,
  RigConnectionFailureReason,
  RigConnectionUncertaintyReason,
  RigObservationView,
} from '@vela/model/web'
import {
  createRigDeviceConnector,
  type RigConnectionSource,
  type RigDeviceConnector,
} from '../device/connection.js'
import {
  createRigDeviceInspector,
  type RigDeviceInspector,
  type RigInspectionSource,
} from '../device/inspection.js'
import type { RigCatalog } from './catalog.js'
import {
  inspectRigDetail,
  type InspectRigDetailResult,
  type RigDetailOptions,
} from './detail.js'
import {
  connectionDeviceView,
  isConnectableDeviceKind,
  rigObservationView,
} from './observation.js'

export type LoadRigObservationResult =
  | { readonly state: 'found'; readonly view: RigObservationView }
  | { readonly state: 'not-found' }

export type ConnectRigDevicesOperationResult =
  | { readonly state: 'finished'; readonly result: ConnectRigDevicesResult }
  | { readonly state: 'in-progress' }
  | { readonly state: 'not-found' }

export type ForgetRigOperationResult =
  | { readonly state: 'forgotten' }
  | { readonly state: 'in-progress' }
  | { readonly state: 'not-found' }

export interface RigConnectionRequestOptions {
  readonly signal?: AbortSignal
  readonly onConflict?: RigDetailOptions['onConflict']
  readonly onProviderResult?: (
    providerDeviceId: string,
    result: AlpacaDeviceConnectionResult | AlpacaProviderError,
  ) => void
  readonly onUnavailable?: RigDetailOptions['onUnavailable']
}

export interface RigConnectionCoordinator {
  loadObservation(
    rigId: string,
    options?: RigConnectionRequestOptions,
  ): Promise<LoadRigObservationResult>
  connectDevices(
    rigId: string,
    options?: RigConnectionRequestOptions,
  ): Promise<ConnectRigDevicesOperationResult>
  forgetRig(rigId: string): Promise<ForgetRigOperationResult>
}

interface RigConnectionCoordinatorOptions {
  readonly catalog: RigCatalog
  readonly createConnector?: (rig: RigConnectionSource) => RigDeviceConnector
  readonly createInspector?: (rig: RigInspectionSource) => RigDeviceInspector
  readonly now?: () => Date
}

interface ConnectionCandidate {
  readonly providerDeviceId: string
  readonly device: RigConnectionDeviceView
}

export function createRigConnectionCoordinator({
  catalog,
  createConnector = createRigDeviceConnector,
  createInspector = createRigDeviceInspector,
  now = () => new Date(),
}: RigConnectionCoordinatorOptions): RigConnectionCoordinator {
  const activeConnections = new Set<string>()
  const activeOperations = new Set<string>()

  function inspect(
    rigId: string,
    options: RigConnectionRequestOptions,
    signal: AbortSignal | null = options.signal ?? null,
  ): Promise<InspectRigDetailResult> {
    let inspectionOptions: RigDetailOptions = { createInspector, now }

    if (options.onConflict !== undefined)
      inspectionOptions = { ...inspectionOptions, onConflict: options.onConflict }

    if (options.onUnavailable !== undefined)
      inspectionOptions = { ...inspectionOptions, onUnavailable: options.onUnavailable }

    if (signal !== null) inspectionOptions = { ...inspectionOptions, signal: signal }

    return inspectRigDetail(catalog, rigId, inspectionOptions)
  }

  async function loadObservation(
    rigId: string,
    options: RigConnectionRequestOptions = {},
  ): Promise<LoadRigObservationResult> {
    const detail = await inspect(rigId, options)

    return detail.state === 'not-found'
      ? detail
      : {
          state: 'found',
          view: rigObservationView(detail.view, activeConnections.has(rigId)),
        }
  }

  async function connectDevices(
    rigId: string,
    options: RigConnectionRequestOptions = {},
  ): Promise<ConnectRigDevicesOperationResult> {
    if (activeOperations.has(rigId)) return { state: 'in-progress' }
    activeOperations.add(rigId)
    activeConnections.add(rigId)

    try {
      const detail = await inspect(rigId, options)

      if (detail.state === 'not-found') return detail

      if (detail.state !== 'current') {
        return {
          state: 'finished',
          result: unavailableResult(detail),
        }
      }

      const candidates = connectionCandidates(detail)

      const unavailableDevice = detail.inspections.find((device) =>
        isConnectableDeviceKind(device.kind) && device.connection === 'unavailable')

      if (unavailableDevice !== undefined) {
        return {
          state: 'finished',
          result: {
            outcome: 'unavailable',
            reason: 'device-state-unavailable',
            view: rigObservationView(detail.view),
          },
        }
      }

      if (candidates.length === 0) {
        return {
          state: 'finished',
          result: {
            outcome: 'complete',
            command: 'not-needed',
            confirmedConnected: [],
            view: rigObservationView(detail.view),
          },
        }
      }

      const connector = createConnector({
        id: detail.view.id,
        endpoint: detail.view.endpoint,
      })

      const confirmedConnected: RigConnectionDeviceView[] = []

      for (let index = 0; index < candidates.length; index += 1) {
        options.signal?.throwIfAborted()
        const candidate = candidates[index]!
        let result: AlpacaDeviceConnectionResult

        try {
          result = await connector.connectDevice(
            candidate.providerDeviceId,
            options.signal === undefined ? undefined : { signal: options.signal },
          )
        } catch (error) {
          if (options.signal?.aborted) throw error

          if (!(error instanceof AlpacaProviderError)) throw error

          options.onProviderResult?.(candidate.providerDeviceId, error)
          const view = await refreshObservation(rigId, options)

          return {
            state: 'finished',
            result: connectionFailureResult(
              confirmedConnected,
              candidate.device,
              'connection-check-failed',
              candidates.slice(index + 1).map(({ device }) => device),
              view,
            ),
          }
        }

        options.onProviderResult?.(candidate.providerDeviceId, result)

        if (result.outcome === 'connected') {
          confirmedConnected.push(candidate.device)
          continue
        }

        const notAttempted = candidates.slice(index + 1).map(({ device }) => device)
        const view = await refreshObservation(rigId, options)

        if (result.outcome === 'failed') {
          return {
            state: 'finished',
            result: connectionFailureResult(
              confirmedConnected,
              candidate.device,
              result.reason,
              notAttempted,
              view,
            ),
          }
        }

        return {
          state: 'finished',
          result: resolvedUncertainResult(
            confirmedConnected,
            candidate.device,
            result.reason,
            notAttempted,
            view,
          ),
        }
      }

      return {
        state: 'finished',
        result: {
          outcome: 'complete',
          command: 'completed',
          confirmedConnected: [confirmedConnected[0]!, ...confirmedConnected.slice(1)],
          view: await refreshObservation(rigId, options),
        },
      }
    } finally {
      activeConnections.delete(rigId)
      activeOperations.delete(rigId)
    }
  }

  async function forgetRig(rigId: string): Promise<ForgetRigOperationResult> {
    if (activeOperations.has(rigId)) return { state: 'in-progress' }
    activeOperations.add(rigId)

    try {
      return await catalog.forget(rigId)
        ? { state: 'forgotten' }
        : { state: 'not-found' }
    } finally {
      activeOperations.delete(rigId)
    }
  }

  async function refreshObservation(
    rigId: string,
    options: RigConnectionRequestOptions,
  ): Promise<RigObservationView> {
    const refreshed = await inspect(rigId, options, null)

    if (refreshed.state === 'not-found') {
      throw new Error(`Rig ${rigId} disappeared during its connection operation`)
    }

    return rigObservationView(refreshed.view)
  }

  return { loadObservation, connectDevices, forgetRig }
}

function connectionCandidates(
  detail: Extract<InspectRigDetailResult, { readonly state: 'current' }>,
): ReadonlyArray<ConnectionCandidate> {
  const devicesById = new Map(detail.view.devices.map((device) => [device.id, device]))

  return detail.inspections.flatMap((inspection) => {
    if (!isConnectableDeviceKind(inspection.kind) || inspection.connection !== 'disconnected') {
      return []
    }

    const device = devicesById.get(`${detail.view.id}-${inspection.providerDeviceId}`)

    if (device === undefined) {
      throw new Error(`Missing Rig device projection for ${inspection.providerDeviceId}`)
    }

    return [{
      providerDeviceId: inspection.providerDeviceId,
      device: connectionDeviceView(device),
    }]
  })
}

function connectionFailureResult(
  confirmedConnected: ReadonlyArray<RigConnectionDeviceView>,
  failed: RigConnectionDeviceView,
  reason: RigConnectionFailureReason,
  notAttempted: ReadonlyArray<RigConnectionDeviceView>,
  view: RigObservationView,
): ConnectRigDevicesResult {
  if (confirmedConnected.length === 0) {
    return {
      outcome: 'failed',
      confirmedConnected: [],
      failed: { ...failed, reason },
      notAttempted,
      view,
    }
  }

  return {
    outcome: 'partial',
    confirmedConnected: [confirmedConnected[0]!, ...confirmedConnected.slice(1)],
    failed: { ...failed, reason },
    notAttempted,
    view,
  }
}

function resolvedUncertainResult(
  confirmedConnected: ReadonlyArray<RigConnectionDeviceView>,
  uncertain: RigConnectionDeviceView,
  reason: RigConnectionUncertaintyReason,
  notAttempted: ReadonlyArray<RigConnectionDeviceView>,
  view: RigObservationView,
): ConnectRigDevicesResult {
  const refreshedDevice = view.rig.devices.find(({ id }) => id === uncertain.id)

  if (refreshedDevice?.connection === 'disconnected') {
    return connectionFailureResult(
      confirmedConnected,
      uncertain,
      'remained-disconnected',
      notAttempted,
      view,
    )
  }

  if (refreshedDevice?.connection === 'connected') {
    const resolvedConnections: readonly [
      RigConnectionDeviceView,
      ...RigConnectionDeviceView[],
    ] = confirmedConnected.length === 0
      ? [uncertain]
      : [confirmedConnected[0]!, ...confirmedConnected.slice(1), uncertain]

    return notAttempted.length === 0
      ? {
          outcome: 'complete',
          command: 'completed',
          confirmedConnected: resolvedConnections,
          view,
        }
      : {
          outcome: 'partial',
          confirmedConnected: resolvedConnections,
          stoppedAfter: uncertain,
          notAttempted: [notAttempted[0]!, ...notAttempted.slice(1)],
          view,
        }
  }

  return {
    outcome: 'uncertain',
    confirmedConnected,
    uncertain: { ...uncertain, reason },
    notAttempted,
    view,
  }
}

function unavailableResult(
  detail: Exclude<InspectRigDetailResult, { readonly state: 'current' | 'not-found' }>,
): ConnectRigDevicesResult {
  return {
    outcome: 'unavailable',
    reason: detail.state === 'conflict'
      ? 'identity-conflict'
      : detail.reason === 'offline'
        ? 'offline'
        : 'device-state-unavailable',
    view: rigObservationView(detail.view),
  }
}
