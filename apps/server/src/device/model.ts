export type RigDeviceKind =
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

export type RigDeviceConnection = 'connected' | 'disconnected' | 'unavailable'

export interface RigDevice {
  id: string
  rigId: string
  kind: RigDeviceKind
  name: string
  driver: {
    info?: string
    version?: string
  }
  connection: RigDeviceConnection
  status: { state: 'unknown' }
  observedAt: Date
}
