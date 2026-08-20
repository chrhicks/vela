import type { DeviceKind } from '@vela/model/device'

/** Normalize Alpaca device classification without implying operational support. */
export function toDeviceKind(alpacaType: string): DeviceKind {
  switch (alpacaType) {
    case 'Camera':
      return 'camera'
    case 'CoverCalibrator':
      return 'cover-calibrator'
    case 'Dome':
      return 'dome'
    case 'FilterWheel':
      return 'filter-wheel'
    case 'Focuser':
      return 'focuser'
    case 'ObservingConditions':
      return 'observing-conditions'
    case 'Rotator':
      return 'rotator'
    case 'SafetyMonitor':
      return 'safety-monitor'
    case 'Switch':
      return 'switch'
    case 'Telescope':
      return 'telescope'
    default:
      return 'unknown'
  }
}
