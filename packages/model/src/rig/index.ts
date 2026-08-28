import type { DeviceKind, DeviceSummary } from '../device/index.js'

/** Stable Vela-owned Rig identity. Runtime generation and validation are server concerns. */
export type RigId = string

/** ISO-8601 timestamp exchanged between the Vela server and web application. */
export type IsoDateTime = string

/** Normalized Alpaca server location. Protocol and URL construction remain server-owned. */
export interface RigEndpoint {
  readonly host: string
  readonly port: number
}

/** Reachability of the Rig's server endpoint, distinct from device connection state. */
export type RigReachability = 'reachable' | 'unreachable' | 'unknown'

/** Action the server currently permits the web application to offer for a Rig. */
export type RigCapability = 'forget'

/** Operational projection for a known Rig. Network details belong in a details flow. */
export interface RigView {
  readonly id: RigId
  readonly name: string
  readonly reachability: RigReachability
  readonly lastSeenAt?: IsoDateTime
  readonly devices: ReadonlyArray<DeviceSummary>
  readonly capabilities: ReadonlyArray<RigCapability>
}

/** Normalized device detail suitable for discovery inspection in the browser. */
export interface RigDeviceView {
  readonly kind: DeviceKind
  readonly name: string
}

/** Normalized Alpaca server description suitable for browser display. */
export interface RigServerView {
  readonly name?: string
  readonly manufacturer?: string
  readonly manufacturerVersion?: string
  readonly location?: string
}

export type DiscoveryCandidateDisposition =
  | { readonly state: 'new' }
  | {
      readonly state: 'ineligible'
      readonly reason: 'no-stable-device-id'
    }
  | { readonly state: 'already-added'; readonly rigId: RigId }
  | { readonly state: 'conflict' }

/** Transient discovery result. A stable RigId is assigned only after explicit addition. */
export interface DiscoveryCandidateView {
  readonly endpoint: RigEndpoint
  readonly server?: RigServerView
  readonly inspectedAt: IsoDateTime
  readonly devices: ReadonlyArray<RigDeviceView>
  readonly disposition: DiscoveryCandidateDisposition
}

export type DiscoveryFailureReason =
  | 'scan-failed'
  | 'unreachable'
  | 'invalid-response'
  | 'protocol-error'

export interface DiscoveryFailureView {
  readonly endpoint?: RigEndpoint
  readonly reason: DiscoveryFailureReason
}

export interface DiscoveryResultView {
  readonly candidates: ReadonlyArray<DiscoveryCandidateView>
  readonly failures: ReadonlyArray<DiscoveryFailureView>
}
