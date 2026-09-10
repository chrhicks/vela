import { setTimeout as delay } from 'node:timers/promises'
import type { AlpacaAcquisition, AlpacaCameraGeometry, AlpacaFrame, AlpacaFraming, AlpacaTelescopeStatus } from '@vela/alpaca'
import { fromMount, type Site } from '../astronomy/coordinates.js'
import { physicalAlignmentSample, projectPhysicalAlignmentTarget } from './physical-coordinates.js'

export interface PhysicalAlignmentSettings {
  cameraId: string
  cameraName: string
  telescopeId: string
  focalLengthMm: number
}

const difference = (a: number, b: number) => ((a - b + 540) % 360) - 180

/** One explicitly prepared physical RA sweep. Never use coordinate slews here:
 * a pointing model may move DEC even when the requested declination is fixed. */
export function createPhysicalAlignment(settings: PhysicalAlignmentSettings, acquisition: AlpacaAcquisition, device: AlpacaFraming,
  settle: (signal: AbortSignal) => Promise<void> = signal => delay(2_000, undefined, { signal })) {
  let reference: AlpacaTelescopeStatus | undefined
  let geometry: AlpacaCameraGeometry | undefined
  let site: Site | undefined
  let westRate: number | undefined

  async function status(signal: AbortSignal, allowMovement = false) {
    const current = await device.telescopeStatus(settings.telescopeId, signal, { includeAlignmentObservations: true })
    if (current.parked || current.slewing || !current.tracking) throw new Error('Polar alignment requires an idle, unparked mount with tracking enabled')
    if (current.coordinateSystem !== 'topocentric') throw new Error('This physical alignment trial requires topocentric mount coordinates')
    if (current.trackingRate !== 'sidereal' || current.rightAscensionRateSecondsPerSiderealSecond !== 0 || current.declinationRateArcsecondsPerSecond !== 0) {
      throw new Error('Confirm sidereal tracking with zero RA and DEC rate offsets before alignment')
    }
    if (current.latitudeDegrees === undefined || current.longitudeDegrees === undefined || current.latitudeDegrees <= 0 || current.latitudeDegrees > 85) {
      throw new Error('Physical alignment requires the mount’s northern observing location')
    }
    if (reference) {
      const changedSide = (reference.pierSide === 'east' || reference.pierSide === 'west')
        && (current.pierSide === 'east' || current.pierSide === 'west') && current.pierSide !== reference.pierSide
      if (changedSide || current.latitudeDegrees !== reference.latitudeDegrees
        || current.longitudeDegrees !== reference.longitudeDegrees || current.elevationMeters !== reference.elevationMeters) {
        throw new Error('The mount pointing side or observing location changed. Measure a new baseline.')
      }
      if (!allowMovement && (Math.abs(difference(current.rightAscensionDegrees, reference.rightAscensionDegrees)) > 0.02
        || Math.abs(current.declinationDegrees - reference.declinationDegrees) > 0.02)) {
        throw new Error(`Mount position changed after settling: RA ${difference(current.rightAscensionDegrees, reference.rightAscensionDegrees).toFixed(4)}°, DEC ${(current.declinationDegrees - reference.declinationDegrees).toFixed(4)}°. Measure a new baseline.`)
      }
    }
    return current
  }

  async function prepare(signal: AbortSignal) {
    reference = undefined
    westRate = undefined
    await status(signal)
    const observed = await device.cameraGeometry({ cameraId: settings.cameraId, expectedCameraName: settings.cameraName }, signal)
    if (!Number.isFinite(settings.focalLengthMm) || settings.focalLengthMm <= 0) throw new Error('Set the effective focal length before alignment')
    await device.home(settings.telescopeId, signal)
    const homed = await device.telescopeStatus(settings.telescopeId, signal)
    if (!homed.tracking) await device.setTracking(settings.telescopeId, true, signal)
    // Home is a repeatable reset, but lies on the rotation axis. Establish an
    // off-axis field before the RA-only baseline so the images have separation.
    await device.slew({ telescopeId: settings.telescopeId, rightAscensionDegrees: homed.rightAscensionDegrees,
      declinationDegrees: 80, coordinateSystem: homed.coordinateSystem }, signal)
    await settle(signal)
    const current = await status(signal)
    if (Math.abs(current.declinationDegrees - 80) > 1
      || Math.abs(difference(current.rightAscensionDegrees, homed.rightAscensionDegrees)) > 1) {
      throw new Error('The mount did not reach the off-pole alignment starting field')
    }
    reference = current
    geometry = observed
    site = { latitudeDegrees: current.latitudeDegrees!, longitudeDegrees: current.longitudeDegrees!,
      ...(current.elevationMeters === undefined ? {} : { elevationMeters: current.elevationMeters }) }
    return { fieldHeightDegrees: 2 * Math.atan(observed.height * observed.pixelHeightMicrons * observed.binY / 2000 / settings.focalLengthMm) * 180 / Math.PI }
  }

  async function pointing(signal: AbortSignal) {
    await status(signal)
    // Stopped telemetry does not establish that vibration has settled.
    await settle(signal)
    const current = await status(signal)
    const observed = await device.cameraGeometry({ cameraId: settings.cameraId, expectedCameraName: settings.cameraName }, signal)
    if (JSON.stringify(observed) !== JSON.stringify(geometry)) throw new Error('Camera geometry changed. Measure a new baseline.')
    return { hint: fromMount({ raDegrees: current.rightAscensionDegrees, decDegrees: current.declinationDegrees },
      current.coordinateSystem, new Date(current.observedAt), site!), latitude: site!.latitudeDegrees }
  }

  async function move(signal: AbortSignal) {
    const start = await status(signal)
    let current = start
    if (westRate === undefined) {
      // ASCOM leaves MoveAxis sign to the driver. Observe a half-degree probe
      // before choosing the sign for the westward sweep.
      await acquisition.move(settings.telescopeId, 0.5, 1, signal)
      await settle(signal)
      current = await status(signal, true)
      const observed = difference(current.rightAscensionDegrees, start.rightAscensionDegrees)
      if (Math.abs(observed) < 0.1 || Math.abs(observed) > 1) throw new Error(`RA direction check expected 0.1–1° of movement; the mount reported ${observed.toFixed(3)}°`)
      if (Math.abs(current.declinationDegrees - start.declinationDegrees) > 0.1) throw new Error(`RA direction check changed reported DEC by ${(current.declinationDegrees - start.declinationDegrees).toFixed(3)}°`)
      westRate = -Math.sign(observed) * 1.5
    }
    // Observe every bounded increment. No uncertain movement is replayed and
    // an unexpected direction or driver limit ends the measurement.
    for (let step = 0; step < 10; step++) {
      const travelled = -difference(current.rightAscensionDegrees, start.rightAscensionDegrees)
      const remaining = 18 - travelled
      // Solved sightlines supply the geometry; the motor need not land at exactly 18°.
      if (travelled >= 16 && travelled <= 20) { reference = current; return }
      if (travelled > 20 || travelled < -2) throw new Error(`RA sweep reached ${travelled.toFixed(3)}° westward; expected 16–20°`)
      const degrees = Math.min(3, remaining)
      const before = current
      await acquisition.move(settings.telescopeId, westRate, degrees / 1.5, signal)
      await settle(signal)
      current = await status(signal, true)
      const progress = -difference(current.rightAscensionDegrees, before.rightAscensionDegrees)
      console.info('Alignment RA step', { requestedDegrees: degrees, observedDegrees: progress,
        rateDegreesPerSecond: westRate, durationSeconds: degrees / 1.5,
        beforeRaDegrees: before.rightAscensionDegrees, afterRaDegrees: current.rightAscensionDegrees,
        declinationChangeDegrees: current.declinationDegrees - start.declinationDegrees })
      if (progress < degrees * 0.5 || progress > degrees * 1.5
        || Math.abs(current.declinationDegrees - start.declinationDegrees) > 0.1) {
        throw new Error(`RA sweep expected ${degrees.toFixed(3)}° westward; mount reported ${progress.toFixed(3)}° westward and ${(current.declinationDegrees - start.declinationDegrees).toFixed(3)}° DEC change`)
      }
    }
    throw new Error('The RA sweep did not reach its next measurement position')
  }

  return {
    prepare, pointing, move,
    validate: async (signal: AbortSignal, frame?: Pick<AlpacaFrame, 'width' | 'height'>) => {
      const current = await status(signal)
      if (frame && (frame.width !== geometry?.width || frame.height !== geometry.height)) throw new Error('Captured image dimensions changed. Measure a new baseline.')
      return current
    },
    sample: (solved: Parameters<typeof physicalAlignmentSample>[0], frame: Parameters<typeof physicalAlignmentSample>[1]) => physicalAlignmentSample(solved, frame, site!),
    project: (wcs: Parameters<typeof projectPhysicalAlignmentTarget>[0], target: Parameters<typeof projectPhysicalAlignmentTarget>[1], sample: Parameters<typeof projectPhysicalAlignmentTarget>[2]) => projectPhysicalAlignmentTarget(wcs, target, sample, site!),
    cameraName: settings.cameraName,
  }
}

export type PhysicalAlignment = ReturnType<typeof createPhysicalAlignment>
