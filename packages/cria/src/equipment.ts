import { Effect, Exit, Schema } from 'effect'
import type { Device, ParamsOf } from '@cria/wire'
import {
  CaptureStoppedError, CaptureRetryableError, EquipmentError, FocuserStoppedError,
  FrameLostError, FramingStoppedError,
  type Acquisition, type CameraCooling, type CameraCoolingObservation,
  type Focuser, type Framing, type TelescopeStatus,
} from '@vela/equipment'
import { imageBytesPixels } from '@vela/equipment/image-bytes'
import { outcomeOf, type CriaConnection } from './connection.js'
import { createCriaEquipment as createRemoteEquipment } from './v5/equipment.js'
import type { Session } from './v5/session.js'
import type { Motion } from './v5/operation.js'
import { createCriaProvider } from './provider.js'
import { DeviceReadings } from './readings.js'
import { createCriaMountControl } from './mount-control.js'

export interface CriaEquipmentBinding {
  readonly providerDeviceId: string
  readonly id: string
  readonly kind: Device['kind']
  readonly expectedName: string
}

function failure(message: string) {
  return new EquipmentError(message, { reason: 'protocol-error', endpoint: 'Cria' })
}

export function createCriaEquipment(connection: CriaConnection, bindings: ReadonlyArray<CriaEquipmentBinding>) {
  const equipment = (session: Session = connection.session()) => createRemoteEquipment(session, bindings.map(binding => ({
    deviceId: binding.providerDeviceId,
    criaDeviceId: binding.id,
    expectedName: binding.expectedName,
  })))

  function binding(id: string, kind: Device['kind']) {
    const selected = bindings.find(device => device.providerDeviceId === id && device.kind === kind)

    if (!selected) throw failure('Configured Cria device identity does not match this operation')

    return selected
  }

  async function observed(id: string, kind: Device['kind'], signal?: AbortSignal) {
    const selected = binding(id, kind)

    for (;;) {
      signal?.throwIfAborted()
      const received = Effect.runSync(connection.session().received)

      if (received.state === 'interrupted')
        throw new EquipmentError(received.message, { reason: 'transport', endpoint: 'Cria' })
      const device = received.snapshot.devices.find(device => device.id === selected.id)

      if (!device || device.kind !== kind || device.name !== selected.expectedName)
        throw failure('Configured Cria device identity changed')
      const hold = Effect.runSync(equipment().holds).find(hold => hold.deviceId === id)

      if (hold) throw failure(hold.reason)

      if (!device.availability.ready && device.availability.reason === 'refreshing') {
        await Effect.runPromise(Effect.sleep('100 millis'), signal ? { signal } : undefined)
        continue
      }

      const readings = new DeviceReadings(device)

      if (!readings.boolean('connected')) throw failure(`${device.name} is disconnected`)

      return readings
    }
  }

  async function runMount(id: string, command: Motion, signal?: AbortSignal) {
    binding(id, 'mount')
    const result = await outcomeOf(equipment().run(id, command), signal)

    switch (result.kind) {
      case 'confirmed': return result.value
      case 'stopped': throw new FramingStoppedError()
      case 'failed':
      case 'uncertain': throw failure(result.message)
    }
  }

  async function haltMount(id: string) {
    binding(id, 'mount')
    const result = await outcomeOf(equipment().halt(id, 'mount-stop'))

    switch (result.kind) {
      case 'confirmed': return
      case 'stopped': throw new FramingStoppedError()
      case 'failed':
      case 'uncertain': throw failure(result.message)
    }
  }

  const acquisition: Acquisition = {
    async capture(options) {
      const selected = binding(options.cameraId, 'camera')
      const session = connection.session()

      const remote = equipment({
        ...session,
        post: request => Effect.andThen(
          Effect.sync(() => options.onExposureRequested?.()),
          session.post(request),
        ),
      })

      const report = () => {
        const received = Effect.runSync(session.received)
        options.onReadState?.(received.state === 'live' ? 'current' : 'retrying')
        const snapshot = received.state === 'live' ? received.snapshot : undefined
        const running = snapshot?.operations.find(operation => operation.deviceId === selected.id && operation.kind === 'capture' && operation.state === 'running')

        if (running?.state !== 'running') return

        if (running.progress.phase === 'readout' || running.progress.phase === 'retaining') options.onReadout?.()
        else if (running.progress.elapsedSeconds !== null) options.onProgress?.(running.progress.elapsedSeconds)
      }

      const timer = setInterval(report, 250)

      try {
        let parameters: ParamsOf<'capture'> = { exposureSeconds: options.exposureSeconds, light: true }

        if (options.monochromeOnly !== undefined) parameters = { ...parameters, monochromeOnly: options.monochromeOnly }
        const result = await outcomeOf(remote.capture(options.cameraId, parameters), options.signal)

        switch (result.kind) {
          case 'confirmed': {
            if (result.value.kind === 'lost') throw new FrameLostError(result.value.message)
            const { image, bytes } = result.value

            return {
              width: image.width,
              height: image.height,
              pixels: imageBytesPixels(Uint8Array.from(bytes).buffer, image.width, image.height),
              capturedAt: new Date(image.capturedAt).toISOString(),
              capturedAtSource: image.capturedAtSource,
              color: image.color === 'mono' ? { kind: 'mono' } : { kind: 'bayer', pattern: image.color },
            }
          }

          case 'stopped': throw new CaptureStoppedError()
          case 'failed':
            if (result.reason === 'unavailable' || result.reason === 'disconnected' || result.reason === 'busy')
              throw new CaptureRetryableError(failure(result.message))
            throw failure(result.message)
          case 'uncertain': throw failure(result.message)
        }
      } finally {
        clearInterval(timer)
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
        rightAscensionDegrees: readings.number('rightAscensionHours') * 15,
        declinationDegrees: readings.number('declinationDegrees'),
        siderealTimeDegrees: readings.number('siderealTimeHours') * 15,
        latitudeDegrees: readings.number('latitudeDegrees'),
        tracking: readings.boolean('tracking'),
        coordinateSystem,
      }
    },
    async move(id, rateDegreesPerSecond, durationSeconds, signal) {
      const result = await runMount(id, {
        kind: 'mount-axis', parameters: { rateDegreesPerSecond, durationSeconds },
      }, signal)

      return reportedTravel(result.values)
    },
    async rotateRightAscension(id, rateDegreesPerSecond, distanceDegrees, signal) {
      const result = await runMount(id, {
        kind: 'mount-rotate', parameters: { rateDegreesPerSecond, distanceDegrees },
      }, signal)

      return reportedTravel(result.values)
    },
    async abort(cameraId, telescopeId) {
      binding(cameraId, 'camera')
      await haltMount(telescopeId)
    },
  }

  const framing: Framing = {
    async cameraGeometry(options, signal) {
      const readings = await observed(options.cameraId, 'camera', signal)

      return {
        cameraName: readings.device.name,
        sensorWidthPixels: readings.integer('sensorWidthPixels'),
        sensorHeightPixels: readings.integer('sensorHeightPixels'),
        pixelWidthMicrons: readings.number('pixelWidthMicrons'),
        pixelHeightMicrons: readings.number('pixelHeightMicrons'),
        binX: readings.integer('binX'),
        binY: readings.integer('binY'),
        width: readings.integer('width'),
        height: readings.integer('height'),
        startX: readings.integer('startX'),
        startY: readings.integer('startY'),
      }
    },
    async telescopeStatus(id, signal, options) {
      const r = await observed(id, 'mount', signal)

      const status: TelescopeStatus = {
        rightAscensionDegrees: r.number('rightAscensionHours') * 15,
        declinationDegrees: r.number('declinationDegrees'),
        coordinateSystem: r.coordinateSystem(options?.includeAlignmentObservations),
        tracking: r.boolean('tracking'),
        slewing: r.boolean('slewing'),
        parked: r.boolean('parked'),
        observedAt: r.observedAt(['rightAscensionHours', 'declinationDegrees', 'tracking', 'slewing', 'parked']),
      }

      if (r.device.kind === 'mount' && r.device.readings.primaryAxisRates.status === 'fresh')
        status.primaryAxisRates = r.device.readings.primaryAxisRates.value

      const latitude = options?.includeAlignmentObservations
        ? r.number('latitudeDegrees')
        : r.optionalNumber('latitudeDegrees')

      const longitude = options?.includeAlignmentObservations
        ? r.number('longitudeDegrees')
        : r.optionalNumber('longitudeDegrees')

      const elevation = options?.includeAlignmentObservations
        ? r.supportedNumber('elevationMeters')
        : r.optionalNumber('elevationMeters')

      if (latitude !== undefined) status.latitudeDegrees = latitude

      if (longitude !== undefined) status.longitudeDegrees = longitude

      if (elevation !== undefined) status.elevationMeters = elevation

      if (options?.includePointingSide || options?.includeAlignmentObservations)
        status.pierSide = r.pierSide()

      if (options?.includeAlignmentObservations) {
        status.trackingRate = r.trackingRate()
        status.rightAscensionRateSecondsPerSiderealSecond = r.number('rightAscensionRateSecondsPerSiderealSecond')
        status.declinationRateArcsecondsPerSecond = r.number('declinationRateArcsecondsPerSecond')
      }

      return status
    },
    async setTracking(id, tracking, signal) {
      await runMount(id, {
        kind: 'mount-tracking', parameters: { tracking },
      }, signal)
    },
    async slew(options, signal) {
      if (options.coordinateSystem !== 'topocentric' && options.coordinateSystem !== 'j2000')
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
      await haltMount(id)
    },
  }

  const focuser: Focuser = {
    async status(id, signal) {
      const r = await observed(id, 'focuser', signal)

      return {
        absolute: r.boolean('absolute'),
        position: r.integer('position'),
        minStep: r.integer('minStep'),
        maxStep: r.integer('maxStep'),
        moving: r.boolean('moving'),
      }
    },
    async move(command) {
      binding(command.focuserId, 'focuser')

      const result = await outcomeOf(equipment().run(command.focuserId, {
        kind: 'focuser-move',
        parameters: {
          position: command.position,
          minPosition: Math.max(1, command.window.minPosition),
          maxPosition: command.window.maxPosition,
        },
      }), command.signal)

      switch (result.kind) {
        case 'confirmed': {
          const decoded = Schema.decodeUnknownExit(Schema.Struct({ position: Schema.Int }))(result.value.values)

          if (Exit.isFailure(decoded)) throw failure('Cria confirmed the move without a position')

          return decoded.value
        }

        case 'stopped': throw new FocuserStoppedError()
        case 'failed':
        case 'uncertain': throw failure(result.message)
      }
    },
    async halt(id) {
      binding(id, 'focuser')
      const result = await outcomeOf(equipment().halt(id, 'focuser-halt'))

      switch (result.kind) {
        case 'confirmed': return
        case 'stopped': throw new FocuserStoppedError()
        case 'failed':
        case 'uncertain': throw failure(result.message)
      }
    },
  }

  const cooling: CameraCooling = {
    async observe(id, signal) { return coolingObservation(await observed(id, 'camera', signal)) },
    async setCooling(command) {
      binding(command.cameraId, 'camera')
      const before = await cooling.observe(command.cameraId)

      if (!before) return { outcome: 'failed', reason: 'rejected', message: 'Fresh cooling state is unavailable.' }
      let parameters: ParamsOf<'cooling'> = {}

      if (command.coolerOn !== undefined) parameters = { ...parameters, coolerOn: command.coolerOn }

      if (command.setpointC !== undefined) parameters = { ...parameters, setpointC: command.setpointC }
      const result = await outcomeOf(equipment().run(command.cameraId, { kind: 'cooling', parameters }), command.signal)

      switch (result.kind) {
        case 'confirmed': {
          let observation: CameraCoolingObservation = {
            ...before,
            state: command.coolerOn === undefined ? before.state : command.coolerOn ? 'on' : 'off',
          }

          if (command.setpointC !== undefined) observation = { ...observation, setpointC: command.setpointC }

          return { outcome: 'confirmed', observation }
        }

        case 'uncertain': return { outcome: 'uncertain', reason: 'write-outcome-unknown' }
        case 'stopped': return { outcome: 'uncertain', reason: 'cancelled' }
        case 'failed': return { outcome: 'failed', reason: 'rejected', message: result.message }
      }
    },
  }

  const holds = () => Effect.runSync(equipment().holds)

  return {
    acquisition, framing, focuser, cooling,
    mountControl: createCriaMountControl(connection, bindings),
    provider: createCriaProvider(connection, bindings),
    holds,
    async recover(deviceId: string, note: string): Promise<{ outcome: 'confirmed'; found: string } | { outcome: 'failed'; message: string }> {
      const hold = holds().find(hold => hold.deviceId === deviceId)

      if (!hold) return { outcome: 'failed', message: 'This device has no hold. Check its current state.' }
      const result = await outcomeOf(equipment().recover(hold.token, { confirmed: true, note }))

      switch (result.kind) {
        case 'confirmed': return { outcome: 'confirmed', found: result.value.found }
        case 'failed':
        case 'uncertain': return { outcome: 'failed', message: result.message }
        case 'stopped': return { outcome: 'failed', message: 'Recovery stopped before it was confirmed.' }
      }
    },
  }
}

function coolingObservation(r: DeviceReadings): CameraCoolingObservation | undefined {
  const on = r.optionalBoolean('coolerOn')

  if (on === undefined || r.device.kind !== 'camera') return undefined
  const sensor = r.optionalNumber('temperatureC')
  const setpoint = r.device.lastCommandedSetpointC?.value
  const power = r.optionalNumber('coolerPowerPercent')

  let observation: CameraCoolingObservation = {
    state: on ? 'on' : 'off',
    canSetTemperature: r.optionalBoolean('canSetTemperature') === true,
    canGetPower: r.optionalBoolean('canGetCoolerPower') === true,
  }

  if (sensor !== undefined) observation = { ...observation, sensorTemperatureC: sensor }

  if (setpoint !== undefined) observation = { ...observation, setpointC: setpoint }

  if (power !== undefined) observation = { ...observation, powerPercent: power }

  return observation
}

function reportedTravel(values: import('@cria/wire').OperationResult['values']) {
  const decoded = Schema.decodeUnknownExit(Schema.Struct({ travelledDegrees: Schema.Number }))(values)

  if (Exit.isFailure(decoded)) throw failure('Cria confirmed axis motion without its measured travel')

  return decoded.value
}
