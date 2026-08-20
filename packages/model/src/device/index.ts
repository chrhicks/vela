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

export type DeviceStatus =
  | { readonly state: 'idle' }
  | { readonly state: 'busy'; readonly activity?: string }
  | { readonly state: 'capturing'; readonly progress?: number }
  | { readonly state: 'slewing' }
  | { readonly state: 'moving' }
  | { readonly state: 'parked' }
  | { readonly state: 'error'; readonly message: string }
  | { readonly state: 'unknown' }

export type ConnectionStatus = 'connected' | 'disconnected' | 'unavailable'

export interface DeviceSummary {
  readonly id: string
  readonly rigId: string
  readonly kind: DeviceKind
  readonly name: string
  readonly driver: {
    readonly info?: string
    readonly version?: string
  }
  readonly connection: ConnectionStatus
  readonly status: DeviceStatus
  readonly updatedAt: string
}
