import type { DeviceKind } from '../device/index.js'
import type { RigDetailView } from './rig-detail.js'

export type RigConnectionCapability = 'connect-devices'

export type RigConnectionPreparation =
  | {
      readonly state: 'available'
      readonly capabilities: readonly ['connect-devices']
    }
  | {
      readonly state: 'complete' | 'in-progress' | 'unavailable'
      readonly capabilities: readonly []
    }

export interface RigObservationView {
  readonly rig: RigDetailView
  readonly connectionPreparation: RigConnectionPreparation
}

export interface RigConnectionDeviceView {
  readonly id: string
  readonly kind: DeviceKind
  readonly name: string
}

export type RigConnectionFailureReason =
  | 'connection-check-failed'
  | 'device-not-found'
  | 'rejected'
  | 'remained-disconnected'

export type RigConnectionUncertaintyReason =
  | 'cancelled'
  | 'verification-timeout'
  | 'verification-unavailable'
  | 'write-outcome-unknown'

type NonEmptyRigConnectionDevices = readonly [RigConnectionDeviceView, ...RigConnectionDeviceView[]]

export type ConnectRigDevicesResult =
  | {
      readonly outcome: 'complete'
      readonly command: 'not-needed'
      readonly confirmedConnected: readonly []
      readonly view: RigObservationView
    }
  | {
      readonly outcome: 'complete'
      readonly command: 'completed'
      readonly confirmedConnected: NonEmptyRigConnectionDevices
      readonly view: RigObservationView
    }
  | {
      readonly outcome: 'failed'
      readonly confirmedConnected: readonly []
      readonly failed: RigConnectionDeviceView & {
        readonly reason: RigConnectionFailureReason
      }
      readonly notAttempted: ReadonlyArray<RigConnectionDeviceView>
      readonly view: RigObservationView
    }
  | {
      readonly outcome: 'partial'
      readonly confirmedConnected: NonEmptyRigConnectionDevices
      readonly failed: RigConnectionDeviceView & {
        readonly reason: RigConnectionFailureReason
      }
      readonly notAttempted: ReadonlyArray<RigConnectionDeviceView>
      readonly view: RigObservationView
    }
  | {
      readonly outcome: 'partial'
      readonly confirmedConnected: NonEmptyRigConnectionDevices
      readonly stoppedAfter: RigConnectionDeviceView
      readonly notAttempted: NonEmptyRigConnectionDevices
      readonly view: RigObservationView
    }
  | {
      readonly outcome: 'uncertain'
      readonly confirmedConnected: ReadonlyArray<RigConnectionDeviceView>
      readonly uncertain: RigConnectionDeviceView & {
        readonly reason: RigConnectionUncertaintyReason
      }
      readonly notAttempted: ReadonlyArray<RigConnectionDeviceView>
      readonly view: RigObservationView
    }
  | {
      readonly outcome: 'unavailable'
      readonly reason: 'device-state-unavailable' | 'identity-conflict' | 'offline'
      readonly view: RigObservationView
    }
