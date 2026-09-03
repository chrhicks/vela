import type { ConnectionStatus, DeviceKind } from '../device/index.js'
import type {
  IsoDateTime,
  RigCapability,
  RigDeviceConnectionSummary,
  RigEndpoint,
  RigId,
  RigState,
} from '../rig/index.js'

export type RigDeviceStatusAvailability =
  | 'complete'
  | 'partial'
  | 'unavailable'
  | 'unsupported'

export interface UnavailableRigDeviceStatus {
  readonly availability: 'unavailable'
}

export interface UnsupportedRigDeviceStatus {
  readonly availability: 'unsupported'
}

interface RigDeviceIdentity {
  readonly id: string
  readonly name: string
  readonly configuredName: string
}

interface ConnectedRigDeviceDetail extends RigDeviceIdentity {
  readonly connection: Extract<ConnectionStatus, 'connected'>
  readonly observedAt: IsoDateTime
}

type UnavailableRigDeviceDetail = RigDeviceIdentity & (
  | {
      readonly connection: Extract<ConnectionStatus, 'disconnected'>
      readonly observedAt: IsoDateTime
    }
  | {
      readonly connection: Extract<ConnectionStatus, 'unavailable'>
      readonly observedAt?: IsoDateTime
    }
)

type RigDeviceView<Kind extends DeviceKind, Status> =
  | (ConnectedRigDeviceDetail & {
      readonly kind: Kind
      readonly status: Status | UnsupportedRigDeviceStatus
    })
  | (UnavailableRigDeviceDetail & {
      readonly kind: Kind
      readonly status: UnavailableRigDeviceStatus
    })

export interface RigCameraStatus {
  readonly availability: 'complete' | 'partial'
  readonly activity:
    | 'idle'
    | 'waiting'
    | 'exposing'
    | 'reading'
    | 'downloading'
    | 'error'
    | 'unknown'
  readonly sensorTemperatureC?: number
  readonly cooling?: {
    readonly state: 'on' | 'off'
    readonly powerPercent?: number
  }
}

export type RigCameraDeviceView = RigDeviceView<'camera', RigCameraStatus>

export interface RigTelescopeStatus {
  readonly availability: 'complete' | 'partial'
  readonly activity: 'idle' | 'tracking' | 'slewing' | 'parked' | 'unknown'
  readonly tracking: 'on' | 'off' | 'unknown'
  readonly parking: 'parked' | 'unparked' | 'unknown'
  readonly home: 'at-home' | 'away' | 'unknown'
}

export type RigTelescopeDeviceView = RigDeviceView<'telescope', RigTelescopeStatus>

export interface RigFocuserStatus {
  readonly availability: 'complete' | 'partial'
  readonly activity: 'idle' | 'moving' | 'unknown'
  readonly position?: number
  readonly temperatureC?: number
}

export type RigFocuserDeviceView = RigDeviceView<'focuser', RigFocuserStatus>

export interface RigFilterWheelStatus {
  readonly availability: 'complete' | 'partial'
  readonly activity: 'idle' | 'moving' | 'unknown'
  readonly position?: number
  readonly filterName?: string
}

export type RigFilterWheelDeviceView = RigDeviceView<'filter-wheel', RigFilterWheelStatus>

export interface RigObservingConditionsStatus {
  readonly availability: 'complete' | 'partial'
  readonly activity: 'reporting' | 'unknown'
  readonly temperatureC?: number
  readonly humidityPercent?: number
  readonly dewPointC?: number
}

export type RigObservingConditionsDeviceView = RigDeviceView<
  'observing-conditions',
  RigObservingConditionsStatus
>

export interface RigSwitchChannelView {
  readonly id: number
  readonly name: string
  readonly on?: boolean
  readonly value?: number
}

export interface RigSwitchStatus {
  readonly availability: 'complete' | 'partial'
  readonly activity: 'reporting' | 'unknown'
  readonly channels?: ReadonlyArray<RigSwitchChannelView>
}

export type RigSwitchDeviceView = RigDeviceView<'switch', RigSwitchStatus>

type SupportedRigDeviceKind =
  | 'camera'
  | 'telescope'
  | 'focuser'
  | 'filter-wheel'
  | 'observing-conditions'
  | 'switch'

export type UnsupportedRigDeviceView = RigDeviceView<
  Exclude<DeviceKind, SupportedRigDeviceKind>,
  never
>

export type RigDeviceDetailView =
  | RigCameraDeviceView
  | RigTelescopeDeviceView
  | RigFocuserDeviceView
  | RigFilterWheelDeviceView
  | RigObservingConditionsDeviceView
  | RigSwitchDeviceView
  | UnsupportedRigDeviceView

export interface RigDetailView {
  readonly id: RigId
  readonly name: string
  readonly state: RigState
  readonly endpoint: RigEndpoint
  readonly addedAt: IsoDateTime
  readonly lastInventoryAt: IsoDateTime
  readonly refreshedAt: IsoDateTime
  readonly connections: RigDeviceConnectionSummary
  readonly devices: ReadonlyArray<RigDeviceDetailView>
  readonly capabilities: ReadonlyArray<RigCapability>
}
