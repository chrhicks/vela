import type { DeviceKind } from '@vela/model/device'
import type { IsoDateTime, RigEndpoint, RigId } from '@vela/model/rig'

/**
 * Server-owned durable Rig record. Persistence schemas and file I/O are added
 * by the catalog implementation, not by the shared model package.
 */
export interface RigCatalogRecord {
  readonly id: RigId
  readonly name: string
  readonly endpoint: RigEndpoint
  readonly imagingCamera?: { readonly uniqueId: string; readonly name: string }
  readonly focalLengthMm?: number
  readonly addedAt: IsoDateTime
  readonly lastObservedInventory: ObservedRigInventory
}

/**
 * Replaceable snapshot from one successful provider inspection. Device order
 * is not semantically significant when later reconciliation compares snapshots.
 */
export interface ObservedRigInventory {
  readonly observedAt: IsoDateTime
  readonly devices: ReadonlyArray<ObservedDeviceRecord>
}

/** Normalized provider evidence. Raw Alpaca wire fields must not reach this record. */
export interface ObservedDeviceRecord {
  readonly uniqueId: string
  readonly kind: DeviceKind
  readonly name: string
}

/** Detailed reconciliation result retained inside the server. */
export type RigCandidateMatch =
  | { readonly state: 'new' }
  | {
      readonly state: 'known'
      readonly rigId: RigId
      readonly endpointChanged: boolean
      readonly inventoryChanged: boolean
    }
  | {
      readonly state: 'conflict'
      readonly rigIds: ReadonlyArray<RigId>
    }
