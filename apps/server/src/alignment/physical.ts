import { setTimeout as delay } from 'node:timers/promises'
import { SpanStatusCode, trace } from '@opentelemetry/api'
import type {
  Acquisition,
  CameraGeometry,
  Frame,
  Framing,
  TelescopeStatus,
} from '@vela/equipment'
import { fromMount, type Site } from '../astronomy/coordinates.js'
import {
  localSiderealDegrees,
  physicalAlignmentSample,
  projectPhysicalAlignmentTarget,
} from './physical-coordinates.js'
import {
  DEFAULT_MAX_LEG_SECONDS,
  SWEEP_MAXIMUM_DEGREES,
  SWEEP_MINIMUM_DEGREES,
  SWEEP_TARGET_DEGREES,
  chooseSweepRate,
  legCount,
  nearestAdvertisedRate,
} from './sweep.js'

export interface PhysicalAlignmentSettings {
  cameraId: string
  cameraName: string
  telescopeId: string
  focalLengthMm: number
  /** Must be a rate the mount advertises. Default: the fastest advertised rate at or below 1°/s. */
  sweepRateDegreesPerSecond?: number
  /** No single rotate lasts longer than this. */
  maxLegSeconds?: number
}

const tracer = trace.getTracer('vela.alignment')

const difference = (a: number, b: number) => ((a - b + 540) % 360) - 180

/** One explicitly prepared physical RA sweep. Never use coordinate slews here:
 * a pointing model may move DEC even when the requested declination is fixed. */
export function createPhysicalAlignment(
  settings: PhysicalAlignmentSettings,
  acquisition: Acquisition,
  device: Framing,
  settle: (signal: AbortSignal) => Promise<void> = signal => delay(3_000, undefined, { signal }),
) {
  let reference: TelescopeStatus | undefined
  let geometry: CameraGeometry | undefined
  let site: Site | undefined
  let westRate: number | undefined

  async function status(
    signal: AbortSignal,
    { allowMovement = false, allowTrackingOff = false } = {},
  ) {
    const current = await device.telescopeStatus(settings.telescopeId, signal, {
      includeAlignmentObservations: true,
    })

    if (current.parked || current.slewing || (!current.tracking && !allowTrackingOff))
      throw new Error('Polar alignment requires an idle, unparked mount with tracking enabled')

    if (current.coordinateSystem !== 'topocentric')
      throw new Error('This physical alignment trial requires topocentric mount coordinates')

    if (
      current.trackingRate !== 'sidereal' ||
      current.rightAscensionRateSecondsPerSiderealSecond !== 0 ||
      current.declinationRateArcsecondsPerSecond !== 0
    ) {
      throw new Error(
        'Confirm sidereal tracking with zero RA and DEC rate offsets before alignment',
      )
    }

    if (
      current.latitudeDegrees === undefined ||
      current.longitudeDegrees === undefined ||
      current.latitudeDegrees <= 0 ||
      current.latitudeDegrees > 85
    ) {
      throw new Error('Physical alignment requires the mount’s northern observing location')
    }

    if (reference) {
      const fieldFromMeridian = difference(
        current.rightAscensionDegrees,
        localSiderealDegrees(new Date(current.observedAt), site!),
      )

      if (fieldFromMeridian < 5 || fieldFromMeridian > 170) {
        throw new Error(
          'The alignment field is approaching the meridian boundary. Measure a new baseline.',
        )
      }

      const changedSide =
        (reference.pierSide === 'east' || reference.pierSide === 'west') &&
        (current.pierSide === 'east' || current.pierSide === 'west') &&
        current.pierSide !== reference.pierSide

      if (
        changedSide ||
        current.latitudeDegrees !== reference.latitudeDegrees ||
        current.longitudeDegrees !== reference.longitudeDegrees ||
        current.elevationMeters !== reference.elevationMeters
      ) {
        throw new Error(
          'The mount pointing side or observing location changed. Measure a new baseline.',
        )
      }

      if (
        !allowMovement &&
        (Math.abs(difference(current.rightAscensionDegrees, reference.rightAscensionDegrees)) >
          0.02 ||
          Math.abs(current.declinationDegrees - reference.declinationDegrees) > 0.02)
      ) {
        throw new Error(
          `Mount position changed after settling: RA ${difference(current.rightAscensionDegrees, reference.rightAscensionDegrees).toFixed(4)}°, DEC ${(current.declinationDegrees - reference.declinationDegrees).toFixed(4)}°. Measure a new baseline.`,
        )
      }
    }

    return current
  }

  async function prepare(signal: AbortSignal) {
    reference = undefined
    westRate = undefined
    const initial = await status(signal, { allowTrackingOff: true })
    chooseSweepRate(initial, settings.sweepRateDegreesPerSecond)
    site = {
      latitudeDegrees: initial.latitudeDegrees!,
      longitudeDegrees: initial.longitudeDegrees!,
    }

    if (initial.elevationMeters !== undefined) site.elevationMeters = initial.elevationMeters

    const observed = await device.cameraGeometry(
      { cameraId: settings.cameraId, expectedCameraName: settings.cameraName },
      signal,
    )

    if (!Number.isFinite(settings.focalLengthMm) || settings.focalLengthMm <= 0)
      throw new Error('Set the effective focal length before alignment')
    await device.home(settings.telescopeId, signal)
    const homed = await device.telescopeStatus(settings.telescopeId, signal)

    if (!homed.tracking) await device.setTracking(settings.telescopeId, true, signal)
    // Home is a repeatable reset, but lies on the rotation axis. Establish an
    // off-axis field before the RA-only baseline so the images have separation.
    // A fixed hour angle avoids the ambiguous RA reported at Home and keeps
    // the entire westward sweep east of the meridian.
    const startingRa = (localSiderealDegrees(new Date(homed.observedAt), site) + 130) % 360
    await device.slew(
      {
        telescopeId: settings.telescopeId,
        rightAscensionDegrees: startingRa,
        declinationDegrees: 80,
        coordinateSystem: homed.coordinateSystem,
      },
      signal,
    )
    await settle(signal)
    const current = await status(signal)

    if (
      Math.abs(current.declinationDegrees - 80) > 1 ||
      Math.abs(difference(current.rightAscensionDegrees, startingRa)) > 1
    ) {
      throw new Error('The mount did not reach the off-pole alignment starting field')
    }

    reference = current
    geometry = observed
    site = {
      latitudeDegrees: current.latitudeDegrees!,
      longitudeDegrees: current.longitudeDegrees!,
    }

    if (current.elevationMeters !== undefined) site.elevationMeters = current.elevationMeters

    return {
      fieldHeightDegrees:
        (2 *
          Math.atan(
            (observed.height * observed.pixelHeightMicrons * observed.binY) /
              2000 /
              settings.focalLengthMm,
          ) *
          180) /
        Math.PI,
    }
  }

  /** `afterSettling`: the caller has just waited one cancellable settling interval itself. */
  async function pointing(signal: AbortSignal, { afterSettling = false } = {}) {
    if (!afterSettling) {
      await status(signal)
      // Stopped telemetry does not establish that vibration has settled.
      await settle(signal)
    }

    const current = await status(signal)

    const observed = await device.cameraGeometry(
      { cameraId: settings.cameraId, expectedCameraName: settings.cameraName },
      signal,
    )

    if (!sameCameraGeometry(observed, geometry))
      throw new Error('Camera geometry changed. Measure a new baseline.')

    return {
      hint: fromMount(
        { raDegrees: current.rightAscensionDegrees, decDegrees: current.declinationDegrees },
        current.coordinateSystem,
        new Date(current.observedAt),
        site!,
      ),
      latitude: site!.latitudeDegrees,
      observation: { site: { ...site! }, camera: observed, mount: current },
    }
  }

  async function move(signal: AbortSignal) {
    const start = await status(signal)
    let current = start
    // Degrees moved westward since `start`, the probe included.
    let westward = 0

    if (westRate === undefined) {
      // ASCOM leaves MoveAxis sign to the driver. Observe a quarter-degree probe
      // before choosing the sign for the westward sweep.
      const probeRate = nearestAdvertisedRate(start, 0.25)
      const probe = await acquisition.move(settings.telescopeId, probeRate, 1, signal)
      await settle(signal)
      current = await status(signal, { allowMovement: true })
      const observed = probe?.travelledDegrees ?? difference(current.rightAscensionDegrees, start.rightAscensionDegrees)

      if (Math.abs(observed) < 0.1 || Math.abs(observed) > 1)
        throw new Error(
          `RA direction check expected 0.1–1° of movement; the mount reported ${observed.toFixed(3)}°`,
        )

      if (Math.abs(current.declinationDegrees - start.declinationDegrees) > 0.1)
        throw new Error(
          `RA direction check changed reported DEC by ${(current.declinationDegrees - start.declinationDegrees).toFixed(3)}°`,
        )
      westward = -observed
      const sweepRate = chooseSweepRate(start, settings.sweepRateDegreesPerSecond)
      westRate = -Math.sign(observed) * sweepRate
    }

    const signedRate = westRate
    const rate = Math.abs(signedRate)
    const maxLegSeconds = settings.maxLegSeconds ?? DEFAULT_MAX_LEG_SECONDS
    let legsLeft = legCount(SWEEP_TARGET_DEGREES - westward, rate, maxLegSeconds)
    const legs = legsLeft
    const travels: number[] = []

    // Consecutive rotates, none past the leg limit. Each leg asks for what is left
    // divided by the legs still to go, so one leg's stop error is made up by the others.
    while (legsLeft > 0 && westward < SWEEP_MINIMUM_DEGREES) {
      signal.throwIfAborted()
      const distance = (SWEEP_TARGET_DEGREES - westward) / legsLeft
      const leg = legs - legsLeft + 1

      const reported = await tracer.startActiveSpan(
        'alignment.sweep_leg',
        {
          attributes: {
            'alignment.sweep.leg': leg,
            'alignment.sweep.legs': legs,
            'alignment.sweep.rate_degrees_per_second': signedRate,
            'alignment.sweep.asked_degrees': distance,
          },
        },
        async span => {
          const startedAt = performance.now()

          try {
            const rotation = await acquisition.rotateRightAscension(
              settings.telescopeId,
              signedRate,
              -distance,
              signal,
            )

            await settle(signal)
            current = await status(signal, { allowMovement: true })

            if (Math.abs(current.declinationDegrees - start.declinationDegrees) > 0.1)
              throw new Error(
                `RA sweep changed reported DEC by ${(current.declinationDegrees - start.declinationDegrees).toFixed(3)}° in leg ${leg} of ${legs}`,
              )

            const travelled = rotation
              ? -rotation.travelledDegrees
              : -difference(current.rightAscensionDegrees, start.rightAscensionDegrees) - westward

            span.setAttributes({
              'alignment.sweep.travelled_degrees': travelled,
              'alignment.sweep.reported': !!rotation,
              'alignment.sweep.duration_ms': Math.round(performance.now() - startedAt),
            })

            return travelled
          } catch (error) {
            span.setAttribute('alignment.sweep.duration_ms', Math.round(performance.now() - startedAt))
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: error instanceof Error ? error.message : 'RA sweep leg failed',
            })

            if (error instanceof Error) span.recordException(error)
            throw error
          } finally {
            span.end()
          }
        },
      )

      westward += reported
      travels.push(reported)
      legsLeft--
    }

    if (
      westward < SWEEP_MINIMUM_DEGREES - 1e-6 ||
      westward > SWEEP_MAXIMUM_DEGREES ||
      Math.abs(current.declinationDegrees - start.declinationDegrees) > 0.1
    ) {
      throw new Error(
        `RA sweep expected ${SWEEP_MINIMUM_DEGREES}–${SWEEP_MAXIMUM_DEGREES}° westward; mount reported ${westward.toFixed(3)}° over ${travels.length} leg${travels.length === 1 ? '' : 's'} (${travels.map(travel => travel.toFixed(3)).join(', ')}°) and ${(current.declinationDegrees - start.declinationDegrees).toFixed(3)}° DEC change`,
      )
    }

    reference = current
  }

  return {
    prepare,
    pointing,
    move,
    validate: async (signal: AbortSignal, frame?: Pick<Frame, 'width' | 'height'>) => {
      const current = await status(signal)

      if (frame && (frame.width !== geometry?.width || frame.height !== geometry.height))
        throw new Error('Captured image dimensions changed. Measure a new baseline.')

      return current
    },
    sample: (
      solved: Parameters<typeof physicalAlignmentSample>[0],
      frame: Parameters<typeof physicalAlignmentSample>[1],
    ) => physicalAlignmentSample(solved, frame, site!),
    project: (
      wcs: Parameters<typeof projectPhysicalAlignmentTarget>[0],
      target: Parameters<typeof projectPhysicalAlignmentTarget>[1],
      sample: Parameters<typeof projectPhysicalAlignmentTarget>[2],
    ) => projectPhysicalAlignmentTarget(wcs, target, sample, site!),
    cameraName: settings.cameraName,
  }
}

export type PhysicalAlignment = ReturnType<typeof createPhysicalAlignment>

function sameCameraGeometry(
  observed: CameraGeometry,
  reference: CameraGeometry | undefined,
): boolean {
  return (
    !!reference &&
    observed.cameraName === reference.cameraName &&
    observed.sensorWidthPixels === reference.sensorWidthPixels &&
    observed.sensorHeightPixels === reference.sensorHeightPixels &&
    observed.pixelWidthMicrons === reference.pixelWidthMicrons &&
    observed.pixelHeightMicrons === reference.pixelHeightMicrons &&
    observed.binX === reference.binX &&
    observed.binY === reference.binY &&
    observed.width === reference.width &&
    observed.height === reference.height &&
    observed.startX === reference.startX &&
    observed.startY === reference.startY
  )
}
