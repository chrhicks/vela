export type AlpacaDeviceKind =
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

export type AlpacaConnectionStatus = 'connected' | 'disconnected' | 'unavailable'

export interface AlpacaDevice {
  providerDeviceId: string
  kind: AlpacaDeviceKind
  name: string
  connection: AlpacaConnectionStatus
  driver: {
    info?: string
    version?: string
  }
}

export type AlpacaTelemetryAvailability = 'complete' | 'partial' | 'unavailable'

export type AlpacaCameraActivity =
  | 'idle'
  | 'waiting'
  | 'exposing'
  | 'reading'
  | 'downloading'
  | 'error'

export type AlpacaDeviceTelemetry =
  | {
      readonly kind: 'camera'
      readonly activity?: AlpacaCameraActivity
      readonly sensorTemperatureC?: number
      readonly cooling?: {
        readonly state: 'on' | 'off'
        readonly powerPercent?: number
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
      readonly channels: ReadonlyArray<AlpacaSwitchChannel>
    }
  | { readonly kind: 'unknown' }

export interface AlpacaSwitchChannel {
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

export interface AlpacaDeviceInspection {
  readonly providerDeviceId: string
  readonly kind: AlpacaDeviceKind
  readonly configuredName: string
  readonly name: string
  readonly connection: AlpacaConnectionStatus
  readonly telemetry: {
    readonly availability: AlpacaTelemetryAvailability
    readonly values?: AlpacaDeviceTelemetry
  }
}
