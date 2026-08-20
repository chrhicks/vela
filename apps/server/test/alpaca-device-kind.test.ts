import { describe, expect, it } from 'vitest'
import { toDeviceKind } from '../src/alpaca/device-kind.js'

describe('Alpaca device-kind normalization', () => {
  it.each([
    ['Camera', 'camera'],
    ['CoverCalibrator', 'cover-calibrator'],
    ['Dome', 'dome'],
    ['FilterWheel', 'filter-wheel'],
    ['Focuser', 'focuser'],
    ['ObservingConditions', 'observing-conditions'],
    ['Rotator', 'rotator'],
    ['SafetyMonitor', 'safety-monitor'],
    ['Switch', 'switch'],
    ['Telescope', 'telescope'],
  ] as const)('maps %s to %s', (alpacaType, expected) => {
    expect(toDeviceKind(alpacaType)).toBe(expected)
  })

  it('keeps unrecognized provider types on the unknown path', () => {
    expect(toDeviceKind('Video')).toBe('unknown')
    expect(toDeviceKind('camera')).toBe('unknown')
  })
})
