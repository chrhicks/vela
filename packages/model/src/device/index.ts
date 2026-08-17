export type DeviceKind =
  | 'camera'
  | 'telescope'
  | 'focuser'
  | 'observing-conditions'
  | 'unknown'
  
export type DeviceStatus =
  | { state: 'idle' }
  | { state: 'busy', activity?: string}
  | { state: 'capturing', progress?: number }
  | { state: 'slewing' }
  | { state: 'moving' }
  | { state: 'parked' }
  | { state: 'error', message: string }
  | { state: 'unknown' }

export type ConnectionStatus = 'connected' | 'disconnected' | 'unavailable'

export interface DeviceSummary {
  id: string
  rigId: string
  kind: DeviceKind
  name: string
  driver: {
    info?: string
    version?: string
  }
  connection: ConnectionStatus
  status: DeviceStatus
  updatedAt: string
}