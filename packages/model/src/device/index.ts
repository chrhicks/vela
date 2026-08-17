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


export interface DeviceSummary {
  id: string
  rigId: string
  kind: DeviceKind
  name: string
  driver: {
    name?: string
    version?: string
  }
  connection: 'connected' | 'disconnected' | 'unavailable'
  status: DeviceStatus
  updatedAt: string
}