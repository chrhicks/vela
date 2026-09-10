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
