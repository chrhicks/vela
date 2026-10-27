import type { HorizonProfile } from './horizon.js'

/** Synthetic: 90 bins of 4 degrees. Bin 0 is a 40 degree tree, bin 1 is untraced, the rest is flat at 5. */
export function syntheticProfile(overrides: Partial<HorizonProfile> = {}): HorizonProfile {
  return {
    version: 1,
    approximate: true,
    note: 'synthetic',
    importedAt: '2026-01-01T00:00:00.000Z',
    offsets: { azimuthDegrees: 0, altitudeDegrees: 0 },
    stepDegrees: 4,
    altitudesDegrees: [40, null, ...Array.from({ length: 88 }, () => 5)],
    ...overrides,
  }
}
