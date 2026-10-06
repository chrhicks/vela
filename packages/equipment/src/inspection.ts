export type DeviceKind =
  | 'camera'
  | 'cover-calibrator'
  | 'dome'
  | 'filter-wheel'
  | 'focuser'
  | 'observing-conditions'
  | 'rotator'
  | 'safety-monitor'
  | 'switch'
  | 'telescope'
  | 'unknown'

export type ConnectionStatus = 'connected' | 'disconnected' | 'unavailable'

export type DeviceConnectionResult =
  | {
      readonly outcome: 'connected'
      readonly command: 'not-needed' | 'requested'
    }
  | {
      readonly outcome: 'failed'
      readonly reason: 'device-not-found' | 'rejected' | 'remained-disconnected'
      readonly message?: string
      readonly errorNumber?: number
    }
  | {
      readonly outcome: 'uncertain'
      readonly reason:
        | 'cancelled'
        | 'verification-timeout'
        | 'verification-unavailable'
        | 'write-outcome-unknown'
    }

export interface EquipmentDevice {
  providerDeviceId: string
  kind: DeviceKind
  name: string
  connection: ConnectionStatus
  observation?: EquipmentObservation
  driver: {
    info?: string
    version?: string
  }
}

export type TelemetryAvailability = 'complete' | 'partial' | 'unavailable'

export type CameraActivity =
  | 'idle'
  | 'waiting'
  | 'exposing'
  | 'reading'
  | 'downloading'
  | 'error'

export type DeviceTelemetry =
  | {
      readonly kind: 'camera'
      readonly activity?: CameraActivity
      readonly sensorTemperatureC?: number
      readonly cooling?: {
        readonly state: 'on' | 'off'
        readonly setpointControl?: boolean
        readonly powerReporting?: boolean
        readonly powerPercent?: number
        /** Confirmed SetCCDTemperature. Not a claim that the cooler is running. */
        readonly setpointC?: number
      }
    }
  | {
      readonly kind: 'telescope'
      readonly parked?: boolean
      readonly atHome?: boolean
      readonly slewing?: boolean
      readonly tracking?: boolean
    }
  | {
      readonly kind: 'focuser'
      readonly position?: number
      readonly maxStep?: number
      readonly moving?: boolean
      readonly temperatureC?: number
    }
  | {
      readonly kind: 'filter-wheel'
      readonly position?: number
      readonly filterName?: string
      readonly moving?: boolean
    }
  | {
      readonly kind: 'observing-conditions'
      readonly temperatureC?: number
      readonly humidityPercent?: number
      readonly dewPointC?: number
    }
  | {
      readonly kind: 'switch'
      readonly channels?: ReadonlyArray<SwitchChannel>
    }
  | { readonly kind: 'unknown' }

export interface SwitchChannel {
  readonly id: number
  readonly name: string
  readonly description?: string
  readonly value?: number
  readonly on?: boolean
  readonly minimum?: number
  readonly maximum?: number
  readonly step?: number
  readonly writable?: boolean
}

export interface EquipmentInspection {
  readonly providerDeviceId: string
  readonly kind: DeviceKind
  readonly configuredName: string
  readonly name: string
  readonly connection: ConnectionStatus
  readonly observation?: EquipmentObservation
  readonly telemetry: {
    readonly availability: TelemetryAvailability
    readonly values?: DeviceTelemetry
  }
}

/** Remote observations retain their measurement time independently of HTTP receipt. */
export interface EquipmentObservation {
  readonly state: 'current' | 'partial' | 'interrupted'
  readonly observedAt?: string
  readonly commandReady: boolean
  readonly message?: string
}
