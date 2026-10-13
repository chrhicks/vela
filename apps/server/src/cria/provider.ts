import { trace, type Attributes } from '@opentelemetry/api'
import {
  CriaCancelledError,
  CriaUncertainError,
  type CriaClient,
  type CriaDevice,
  type CriaDeviceKind,
  type CriaObserveOptions,
  type ObservedState,
} from '@vela/cria'
import {
  EquipmentError,
  type DeviceKind,
  type DeviceTelemetry,
  type EquipmentDevice,
  type EquipmentInspection,
  type EquipmentObservation,
  type EquipmentProvider,
  type SwitchChannel,
} from '@vela/equipment'
import type { CriaEquipmentBinding } from './equipment.js'
import { DeviceReadings } from './readings.js'

const kinds: Record<CriaDeviceKind, DeviceKind> = {
  camera: 'camera', mount: 'telescope', focuser: 'focuser',
  weather: 'observing-conditions', switch: 'switch',
}

const tracer = trace.getTracer('vela.cria')

const cameraStates = ['idle', 'waiting', 'exposing', 'reading', 'downloading', 'error'] as const

export function createCriaProvider(
  client: CriaClient,
  bindings: ReadonlyArray<CriaEquipmentBinding>,
): EquipmentProvider {
  const previous = new Map<string, EquipmentInspection>()

  /** Record changes only, so a long spell is one span and the poll rate never matters. */
  function spell(entered: string, left: string, durationKey: string) {
    const since = new Map<string, number>()

    return {
      enter(binding: CriaEquipmentBinding, cause: Attributes) {
        if (since.has(binding.id)) return
        since.set(binding.id, Date.now())
        tracer.startSpan(entered, { attributes: { 'cria.device.id': binding.id, ...cause } }).end()
      },
      leave(binding: CriaEquipmentBinding) {
        const started = since.get(binding.id)

        if (started === undefined) return
        since.delete(binding.id)
        tracer.startSpan(left, {
          attributes: { 'cria.device.id': binding.id, [durationKey]: Date.now() - started },
        }).end()
      },
    }
  }

  const interruptions = spell('cria.observation.interrupted', 'cria.observation.recovered', 'cria.interrupted.ms')
  // Cria can stop calling a device command-ready (its own 3 s freshness rule) while Vela still accepts its readings.
  const unready = spell('cria.command.unready', 'cria.command.ready', 'cria.unready.ms')

  /** What `client.diagnoseReading` says about one key, as span attributes. */
  function readingCause(snapshot: ObservedState, device: CriaDevice, key: string): Attributes {
    const rejection = client.diagnoseReading(snapshot, device, key) ?? { reason: 'invalid-value' as const }
    const cause: Attributes = { 'cria.reading.key': key, 'cria.reading.reason': rejection.reason }

    if (rejection.reason === 'not-current') cause['cria.reading.status'] = rejection.status

    if (rejection.reason === 'round-trip' || rejection.reason === 'too-old') {
      cause['cria.reading.roundTripMs'] = Math.round(rejection.roundTripMs)
      cause['cria.reading.limitMs'] = rejection.limitMs
    }

    if (rejection.reason === 'too-old') cause['cria.reading.ageMs'] = Math.round(rejection.ageMs)

    return cause
  }

  function interrupted(
    binding: CriaEquipmentBinding,
    message: string,
    cause: Attributes,
  ): EquipmentInspection {
    interruptions.enter(binding, { 'cria.interrupted.message': message, ...cause })
    const known = previous.get(binding.id)

    let observation: EquipmentObservation = {
      state: 'interrupted',
      commandReady: false,
      message,
    }

    if (known?.observation?.observedAt)
      observation = { ...observation, observedAt: known.observation.observedAt }

    return {
      ...(known ?? {
        providerDeviceId: binding.providerDeviceId,
        kind: kinds[binding.kind],
        configuredName: binding.expectedName,
        name: binding.expectedName,
        connection: 'unavailable',
        telemetry: { availability: 'unavailable' },
      }),
      observation,
    }
  }

  function inspection(snapshot: ObservedState, binding: CriaEquipmentBinding): EquipmentInspection {
    try {
      const device = client.device(snapshot, binding.id)
      const r = new DeviceReadings(client, snapshot, device)
      const connected = r.optionalBoolean('connected')
      const name = r.optionalString('name')

      if (connected === undefined || (connected && name !== binding.expectedName)) {
        const key = connected === undefined ? 'connected' : 'name'

        return interrupted(binding, 'Device identity or connection readings are interrupted',
          name === undefined || connected === undefined
            ? readingCause(snapshot, device, key)
            : { 'cria.reading.key': 'name', 'cria.reading.reason': 'name-mismatch' })
      }

      if (device.blocked)
        return interrupted(binding, device.reason ?? 'Device outcome needs attention',
          { 'cria.reading.reason': 'device-blocked' })

      const blocked = client.commandBlockReasonFor(binding.id)

      if (blocked) return interrupted(binding, blocked, { 'cria.reading.reason': 'command-blocked' })

      const values = telemetry(r)
      const partial = r.partial

      let observation: EquipmentObservation = {
        state: partial ? 'partial' : 'current',
        observedAt: r.observedAt(),
        commandReady: snapshot.state.commandsEnabled && device.commandReady && !device.refreshPending,
      }

      if (observation.commandReady) {
        unready.leave(binding)
      } else {
        unready.enter(binding, {
          'cria.command.commandsEnabled': snapshot.state.commandsEnabled,
          'cria.command.deviceReady': device.commandReady,
          'cria.command.refreshPending': device.refreshPending,
          'cria.command.health': device.health,
        })
      }

      if (partial) observation = { ...observation, message: 'Some device readings are unavailable' }

      const result: EquipmentInspection = {
        providerDeviceId: binding.providerDeviceId,
        kind: kinds[binding.kind],
        configuredName: binding.expectedName,
        name: name ?? binding.expectedName,
        connection: connected ? 'connected' : 'disconnected',
        telemetry: connected ? { availability: partial ? 'partial' : 'complete', values }
          : { availability: 'unavailable' },
        observation,
      }

      previous.set(binding.id, result)
      interruptions.leave(binding)

      return result
    } catch (error) {
      if (!(error instanceof EquipmentError)) throw error

      return interrupted(binding, error.message, { 'cria.reading.reason': 'inspection-error' })
    }
  }

  async function inspections(signal?: AbortSignal) {
    signal?.throwIfAborted()

    try {
      const snapshot = await client.state(signal)
      signal?.throwIfAborted()

      return bindings.map(binding => inspection(snapshot, binding))
    } catch (error) {
      if (signal?.aborted || !(error instanceof EquipmentError)) throw error

      return bindings.map(binding =>
        interrupted(binding, error.message, { 'cria.reading.reason': 'state-unavailable' }))
    }
  }

  return {
    async listDevices() {
      return (await inspections()).map(device => {
        const result: EquipmentDevice = {
          providerDeviceId: device.providerDeviceId,
          kind: device.kind,
          name: device.name,
          connection: device.observation?.state === 'interrupted' ? 'unavailable' : device.connection,
          driver: {},
        }

        if (device.observation) result.observation = device.observation

        return result
      })
    },
    inspectDevices: options => inspections(options?.signal),
    async connectDevice(providerDeviceId, options) {
      const binding = bindings.find(device => device.providerDeviceId === providerDeviceId)

      if (!binding) return { outcome: 'failed', reason: 'device-not-found' }

      try {
        let observeOptions: CriaObserveOptions = {
          allowDisconnected: true,
        }

        if (options?.signal) observeOptions = { ...observeOptions, signal: options.signal }

        const { snapshot, device } = await client.observe(binding.id, observeOptions)

        if (new DeviceReadings(client, snapshot, device).boolean('connected'))
          return { outcome: 'connected', command: 'not-needed' }

        await client.run(binding.id, {
          kind: 'device-connect', parameters: { connected: true },
        }, options?.signal ? { signal: options.signal } : {})

        return { outcome: 'connected', command: 'requested' }
      } catch (error) {
        if (error instanceof CriaUncertainError)
          return { outcome: 'uncertain', reason: 'write-outcome-unknown' }

        if (error instanceof CriaCancelledError)
          return { outcome: 'uncertain', reason: 'cancelled' }

        if (error instanceof EquipmentError)
          return { outcome: 'failed', reason: 'rejected', message: error.message }
        throw error
      }
    },
  }
}

function telemetry(r: DeviceReadings): DeviceTelemetry {
  switch (r.device.kind) {
    case 'camera': {
      const state = r.optionalInteger('state', 0, 5)
      const activity = state === undefined ? undefined : cameraStates[state]
      const sensorTemperatureC = r.optionalNumber('temperatureC', -273.15, 1000)
      const coolerOn = r.optionalBoolean('coolerOn')

      let result: Extract<DeviceTelemetry, { kind: 'camera' }> = { kind: 'camera' }

      if (activity !== undefined) result = { ...result, activity }

      if (sensorTemperatureC !== undefined) result = { ...result, sensorTemperatureC }

      if (coolerOn !== undefined) {
        const setpointC = r.optionalNumber('setpointC', -273.15, 1000)
        const powerPercent = r.optionalNumber('coolerPowerPercent', 0, 100)
        const setpointControl = r.optionalBoolean('canSetTemperature', true)
        const powerReporting = r.optionalBoolean('canGetCoolerPower', true)

        let cooling: NonNullable<typeof result.cooling> = { state: coolerOn ? 'on' : 'off' }

        if (setpointC !== undefined) cooling = { ...cooling, setpointC }

        if (powerPercent !== undefined) cooling = { ...cooling, powerPercent }

        if (setpointControl !== undefined) cooling = { ...cooling, setpointControl }

        if (powerReporting !== undefined) cooling = { ...cooling, powerReporting }

        result = { ...result, cooling }
      }

      return result
    }

    case 'mount': {
      const parked = r.optionalBoolean('parked')
      const atHome = r.optionalBoolean('atHome')
      const slewing = r.optionalBoolean('slewing')
      const tracking = r.optionalBoolean('tracking')

      let result: Extract<DeviceTelemetry, { kind: 'telescope' }> = { kind: 'telescope' }

      if (parked !== undefined) result = { ...result, parked }

      if (atHome !== undefined) result = { ...result, atHome }

      if (slewing !== undefined) result = { ...result, slewing }

      if (tracking !== undefined) result = { ...result, tracking }

      return result
    }

    case 'focuser': {
      const position = r.optionalInteger('position', 0, 2147483647)
      const maxStep = r.optionalInteger('maxStep', 1, 2147483647, true)
      const moving = r.optionalBoolean('moving')
      const temperatureC = r.optionalNumber('temperatureC', -273.15, 1000)

      let result: Extract<DeviceTelemetry, { kind: 'focuser' }> = { kind: 'focuser' }

      if (position !== undefined) result = { ...result, position }

      if (maxStep !== undefined) result = { ...result, maxStep }

      if (moving !== undefined) result = { ...result, moving }

      if (temperatureC !== undefined) result = { ...result, temperatureC }

      return result
    }

    case 'weather': {
      const temperatureC = r.optionalNumber('temperatureC', -273.15, 1000)
      const humidityPercent = r.optionalNumber('humidityPercent', 0, 100)
      const dewPointC = r.optionalNumber('dewPointC', -273.15, 1000)

      let result: Extract<DeviceTelemetry, { kind: 'observing-conditions' }> = { kind: 'observing-conditions' }

      if (temperatureC !== undefined) result = { ...result, temperatureC }

      if (humidityPercent !== undefined) result = { ...result, humidityPercent }

      if (dewPointC !== undefined) result = { ...result, dewPointC }

      return result
    }

    case 'switch': {
      const channels: SwitchChannel[] = []

      for (const fields of r.device.channels) {
        const channel = new DeviceReadings(r.client, r.snapshot, { ...r.device, fields })
        const id = channel.optionalInteger('id', 0, 63)

        if (id === undefined) {
          r.include(channel)
          continue
        }

        const name = channel.optionalString('name', true) ?? `Channel ${id}`
        const value = channel.optionalNumber('value', -1e12, 1e12)
        const on = channel.optionalBoolean('on')

        let result: SwitchChannel = { id, name }

        if (value !== undefined) result = { ...result, value }

        if (on !== undefined) result = { ...result, on }

        channels.push(result)
        r.include(channel)
      }

      return { kind: 'switch', channels }
    }
  }
}
