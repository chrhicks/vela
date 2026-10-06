import { z } from 'zod'
import {
  CaptureStoppedError,
  CaptureRetryableError,
  EquipmentError,
  FocuserStoppedError,
  FramingStoppedError,
  type Acquisition,
  type CameraCooling,
  type CameraCoolingObservation,
  type Focuser,
  type Framing,
  type TelescopeStatus,
} from '@vela/equipment'
import {
  CriaCancelledError,
  CriaOperationFailedError,
  CriaNotAdmittedError,
  CriaUncertainError,
  type CriaClient,
  type CriaCommand,
  type CriaDeviceKind,
} from '@vela/cria'
import { DeviceReadings } from './readings.js'
import { createCriaProvider } from './provider.js'
import { createCriaMountControl } from './mount-control.js'

export interface CriaEquipmentBinding {
  readonly providerDeviceId: string
  readonly id: string
  readonly kind: CriaDeviceKind
  readonly expectedName: string
}

export function createCriaEquipment(client: CriaClient, bindings: ReadonlyArray<CriaEquipmentBinding>) {
  function binding(id: string, kind: CriaDeviceKind, expectedName?: string) {
    const selected = bindings.find(device => device.providerDeviceId === id)

    if (!selected || selected.kind !== kind ||
      (expectedName !== undefined && selected.expectedName !== expectedName)) {
      throw new EquipmentError('Configured Cria device identity does not match this operation', {
        reason: 'protocol-error',
        endpoint: 'Cria',
      })
    }

    return selected
  }

  async function observed(id: string, kind: CriaDeviceKind, signal?: AbortSignal, name?: string) {
    const selected = binding(id, kind, name)
    const { snapshot, device } = await client.observe(selected.id, signal ? { signal } : {})

    return new DeviceReadings(client, snapshot, device)
  }

  async function runMount(id: string, command: CriaCommand, signal?: AbortSignal) {
    try {
      await client.run(binding(id, 'mount').id, command, signal ? { signal } : {})
    } catch (error) {
      if (error instanceof CriaCancelledError) throw new FramingStoppedError()
      throw error
    }
  }

  const acquisition: Acquisition = {
    async capture(options) {
      const selected = binding(options.cameraId, 'camera', options.expectedCameraName)

      try {
        const parameters: Extract<CriaCommand, { kind: 'capture' }>['parameters'] = {
          exposureSeconds: options.exposureSeconds,
          light: true,
        }

        if (options.monochromeOnly !== undefined) parameters.monochromeOnly = options.monochromeOnly

        let runOptions: NonNullable<Parameters<CriaClient['run']>[2]> = {
          onProgress(progress) {
            if (progress.phase === 'readout' || progress.phase === 'retaining') {
              options.onReadout?.()

              return
            }

            const elapsedSeconds = progress.elapsedSeconds ?? (progress.startedAt === null ? 0 :
              Math.max(0, (Date.now() - progress.startedAt) / 1000))

            options.onProgress?.(elapsedSeconds)
          },
        }

        if (options.signal) runOptions = { ...runOptions, signal: options.signal }

        if (options.onReadState) runOptions = { ...runOptions, onReadState: options.onReadState }

        const operation = await client.run(selected.id, { kind: 'capture', parameters }, runOptions)
        const downloadOptions = options.onReadState ? { onReadState: options.onReadState } : {}
        const { image, frame } = await client.download(operation, downloadOptions)

        // Vela owns verified pixels now. A lost release only delays remote spool cleanup.
        await client.release(image.id).catch(() => {})

        return frame
      } catch (error) {
        if (error instanceof CriaCancelledError) throw new CaptureStoppedError()

        if (error instanceof CriaNotAdmittedError) throw new CaptureRetryableError(error)
        throw error
      }
    },
    async pointing(id, signal) {
      const readings = await observed(id, 'mount', signal)
      const coordinateSystem = readings.coordinateSystem(true)

      if (coordinateSystem === 'unknown')
        throw new EquipmentError('Mount coordinate frame is unavailable', {
          reason: 'invalid-response', endpoint: 'Cria',
        })

      return {
        rightAscensionDegrees: readings.number('rightAscensionHours', 0, 24) * 15,
        declinationDegrees: readings.number('declinationDegrees', -90, 90),
        siderealTimeDegrees: readings.number('siderealTimeHours', 0, 24) * 15,
        latitudeDegrees: readings.number('latitudeDegrees', -90, 90, true),
        tracking: readings.boolean('tracking'),
        coordinateSystem,
      }
    },
    async move(id, rateDegreesPerSecond, durationSeconds, signal) {
      await runMount(id, {
        kind: 'mount-axis', parameters: { rateDegreesPerSecond, durationSeconds },
      }, signal)
    },
    async rotateRightAscension(id, rateDegreesPerSecond, distanceDegrees, signal) {
      await runMount(id, {
        kind: 'mount-rotate', parameters: { rateDegreesPerSecond, distanceDegrees },
      }, signal)
    },
    async abort(cameraId, telescopeId) {
      await Promise.all([
        client.cancelDevice(binding(cameraId, 'camera').id),
        client.cancelDevice(binding(telescopeId, 'mount').id),
      ])
    },
  }

  const framing: Framing = {
    async cameraGeometry(options, signal) {
      const readings = await observed(options.cameraId, 'camera', signal, options.expectedCameraName)

      return {
        cameraName: readings.device.expectedName,
        sensorWidthPixels: readings.integer('sensorWidthPixels', 1, 1e6, true),
        sensorHeightPixels: readings.integer('sensorHeightPixels', 1, 1e6, true),
        pixelWidthMicrons: readings.number('pixelWidthMicrons', 0.001, 1000, true),
        pixelHeightMicrons: readings.number('pixelHeightMicrons', 0.001, 1000, true),
        binX: readings.integer('binX', 1, 1000, true),
        binY: readings.integer('binY', 1, 1000, true),
        width: readings.integer('width', 1, 1e6, true),
        height: readings.integer('height', 1, 1e6, true),
        startX: readings.integer('startX', 0, 1e6, true),
        startY: readings.integer('startY', 0, 1e6, true),
      }
    },
    async telescopeStatus(id, signal, options) {
      const r = await observed(id, 'mount', signal)

      const status: TelescopeStatus = {
        rightAscensionDegrees: r.number('rightAscensionHours', 0, 24) * 15,
        declinationDegrees: r.number('declinationDegrees', -90, 90),
        coordinateSystem: r.coordinateSystem(options?.includeAlignmentObservations),
        tracking: r.boolean('tracking'),
        slewing: r.boolean('slewing'),
        parked: r.boolean('parked'),
        observedAt: r.observedAt(['rightAscensionHours', 'declinationDegrees', 'tracking', 'slewing', 'parked']),
      }

      const latitude = options?.includeAlignmentObservations
        ? r.number('latitudeDegrees', -90, 90, true)
        : r.optionalNumber('latitudeDegrees', -90, 90, true)

      const longitude = options?.includeAlignmentObservations
        ? r.number('longitudeDegrees', -180, 180, true)
        : r.optionalNumber('longitudeDegrees', -180, 180, true)

      const elevation = options?.includeAlignmentObservations
        ? r.supportedNumber('elevationMeters', -300, 10000, true)
        : r.optionalNumber('elevationMeters', -300, 10000, true)

      if (latitude !== undefined) status.latitudeDegrees = latitude

      if (longitude !== undefined) status.longitudeDegrees = longitude

      if (elevation !== undefined) status.elevationMeters = elevation

      if (options?.includePointingSide || options?.includeAlignmentObservations)
        status.pierSide = r.pierSide()

      if (options?.includeAlignmentObservations) {
        status.trackingRate = r.trackingRate()
        status.rightAscensionRateSecondsPerSiderealSecond = r.number('rightAscensionRateSecondsPerSiderealSecond', -1e6, 1e6)
        status.declinationRateArcsecondsPerSecond = r.number('declinationRateArcsecondsPerSecond', -1e6, 1e6)
      }

      return status
    },
    async setTracking(id, tracking, signal) {
      await runMount(id, {
        kind: 'mount-tracking', parameters: { tracking },
      }, signal)
    },
    async slew(options, signal) {
      if (options.coordinateSystem === 'unknown' || options.coordinateSystem === 'other')
        throw new Error('A known mount coordinate frame is required before slewing')

      await runMount(options.telescopeId, {
        kind: 'mount-slew',
        parameters: {
          rightAscensionDegrees: options.rightAscensionDegrees,
          declinationDegrees: options.declinationDegrees,
          coordinateSystem: options.coordinateSystem,
        },
      }, signal)
    },
    async home(id, signal) {
      await runMount(id, { kind: 'mount-home', parameters: {} }, signal)
    },
    async abortTelescope(id) {
      await client.cancelDevice(binding(id, 'mount').id)
    },
  }

  const focuser: Focuser = {
    async status(id, signal) {
      const r = await observed(id, 'focuser', signal)

      return {
        absolute: r.boolean('absolute', true),
        position: r.integer('position', 0, 2147483647),
        maxStep: r.integer('maxStep', 1, 2147483647, true),
        moving: r.boolean('moving'),
      }
    },
    async move(command) {
      try {
        const operation = await client.run(binding(command.focuserId, 'focuser').id, {
          kind: 'focuser-move',
          parameters: {
            position: command.position,
            minPosition: command.window.minPosition,
            maxPosition: command.window.maxPosition,
          },
        }, command.signal ? { signal: command.signal } : {})

        return z.object({ position: z.number().int().nonnegative() }).parse(operation.result)
      } catch (error) {
        if (error instanceof CriaCancelledError) throw new FocuserStoppedError()
        throw error
      }
    },
    async halt(id) {
      await client.cancelDevice(binding(id, 'focuser').id)
    },
  }

  const cooling: CameraCooling = {
    async observe(id, signal) {
      return coolingObservation(await observed(id, 'camera', signal))
    },
    async setCooling(command) {
      try {
        const parameters: Extract<CriaCommand, { kind: 'cooling' }>['parameters'] = {}

        if (command.coolerOn !== undefined) parameters.coolerOn = command.coolerOn

        if (command.setpointC !== undefined) parameters.setpointC = command.setpointC

        await client.run(binding(command.cameraId, 'camera', command.expectedCameraName).id, {
          kind: 'cooling', parameters,
        }, command.signal ? { signal: command.signal } : {})
      } catch (error) {
        if (error instanceof CriaUncertainError)
          return { outcome: 'uncertain', reason: 'write-outcome-unknown' }

        if (error instanceof CriaCancelledError)
          return { outcome: 'uncertain', reason: 'cancelled' }

        if (error instanceof CriaOperationFailedError)
          return { outcome: 'failed', reason: 'rejected', message: error.message }
        throw error
      }

      try {
        const observation = await cooling.observe(command.cameraId)

        if (observation === undefined)
          return { outcome: 'uncertain', reason: 'verification-unavailable' }

        if ((command.coolerOn !== undefined && (observation.state === 'on') !== command.coolerOn) ||
          (command.setpointC !== undefined && (observation.setpointC === undefined ||
            Math.abs(observation.setpointC - command.setpointC) > 0.15))) {
          return { outcome: 'failed', reason: 'not-confirmed' }
        }

        return { outcome: 'confirmed', observation }
      } catch {
        return { outcome: 'uncertain', reason: 'verification-unavailable' }
      }
    },
  }

  return {
    acquisition, framing, focuser, cooling,
    mountControl: createCriaMountControl(client, bindings),
    provider: createCriaProvider(client, bindings),
  }
}

function coolingObservation(r: DeviceReadings): CameraCoolingObservation | undefined {
  const on = r.optionalBoolean('coolerOn')

  if (on === undefined) return undefined
  const sensor = r.optionalNumber('temperatureC', -273.15, 1000)
  const setpoint = r.optionalNumber('setpointC', -273.15, 1000)
  const power = r.optionalNumber('coolerPowerPercent', 0, 100)

  let observation: CameraCoolingObservation = {
    state: on ? 'on' : 'off',
    canSetTemperature: r.optionalBoolean('canSetTemperature', true) === true,
    canGetPower: r.optionalBoolean('canGetCoolerPower', true) === true,
  }

  if (sensor !== undefined) observation = { ...observation, sensorTemperatureC: sensor }

  if (setpoint !== undefined) observation = { ...observation, setpointC: setpoint }

  if (power !== undefined) observation = { ...observation, powerPercent: power }

  return observation
}
