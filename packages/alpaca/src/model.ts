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
