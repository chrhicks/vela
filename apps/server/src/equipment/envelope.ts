import type { MountEnvelope } from './composition.js'
import type { AlertThresholds } from '../alerts/thresholds.js'
import type { Skyline } from '../targets/horizon.js'

// Step 19's mechanical stub, copied here so Vela owns the rig's runtime policy.
export const stubEnvelope: MountEnvelope = {
  keepOut: [
    { name: 'west high Dec', side: 'normal', minDeclinationDegrees: 75, maxDeclinationDegrees: 90, westHourAngleDegrees: 40 },
    { name: 'west middle Dec', side: 'normal', minDeclinationDegrees: 45, maxDeclinationDegrees: 75, westHourAngleDegrees: 20 },
    { name: 'west low Dec', side: 'normal', minDeclinationDegrees: -90, maxDeclinationDegrees: 45, westHourAngleDegrees: 20 },
  ],
}

export function mountEnvelope(base: MountEnvelope, thresholds: AlertThresholds, skyline: Skyline | null): MountEnvelope {
  return {
    keepOut: base.keepOut,
    meridianLimitDegrees: thresholds.meridianTrackLimitHours * 15,
    ...(skyline && { horizon: skyline.bins.flatMap((bin, index) => bin.kind === 'unknown' ? [] : [{
      azimuthDegrees: index * skyline.stepDegrees,
      altitudeDegrees: bin.altitudeDegrees,
    }]) }),
  }
}
