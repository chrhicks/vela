import { trace } from '@opentelemetry/api'
import { Effect } from 'effect'
import {
  EquipmentError,
  type DeviceKind, type DeviceTelemetry, type EquipmentInspection, type EquipmentDevice,
  type EquipmentObservation, type EquipmentProvider, type SwitchChannel,
} from '@vela/equipment'
import type { Device } from '@cria/wire'
import { outcomeOf, type CriaConnection } from './connection.js'
import { createCriaEquipment as createRemoteEquipment } from './v5/equipment.js'
import type { CriaEquipmentBinding } from './equipment.js'
import { DeviceReadings } from './readings.js'

const kinds: Record<Device['kind'], DeviceKind> = {
  camera: 'camera', mount: 'telescope', focuser: 'focuser',
  weather: 'observing-conditions', switch: 'switch',
}

export function createCriaProvider(connection: CriaConnection, bindings: ReadonlyArray<CriaEquipmentBinding>): EquipmentProvider {
  const previous = new Map<string, EquipmentInspection>()
  const interruptions = new Map<string, number>()
  const tracer = trace.getTracer('vela.cria')

  const remote = () => createRemoteEquipment(connection.session(), bindings.map(binding => ({
    deviceId: binding.providerDeviceId, criaDeviceId: binding.id, expectedName: binding.expectedName,
  })))

  function interrupted(binding: CriaEquipmentBinding, message: string): EquipmentInspection {
    const known = previous.get(binding.id)

    if (!interruptions.has(binding.id)) {
      interruptions.set(binding.id, Date.now())
      tracer.startSpan('cria.observation.interrupted', { attributes: { 'cria.device.id': binding.id, 'cria.interrupted.message': message } }).end()
    }

    let observation: EquipmentObservation = {
      state: 'interrupted', commandReady: false, message,
    }

    if (known?.observation?.observedAt) observation = { ...observation, observedAt: known.observation.observedAt }

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

  async function inspections(signal?: AbortSignal): Promise<EquipmentInspection[]> {
    signal?.throwIfAborted()
    const equipment = remote()
    const received = Effect.runSync(equipment.received)
    const holds = Effect.runSync(equipment.holds)
    const warnings = Effect.runSync(equipment.warnings)

    return bindings.map(binding => {
      if (received.state === 'interrupted') return interrupted(binding, received.message)
      const device = received.snapshot.devices.find(device => device.id === binding.id)

      if (!device || device.kind !== binding.kind || device.name !== binding.expectedName)
        return interrupted(binding, 'Configured Cria device identity changed or is unavailable')
      const r = new DeviceReadings(device)

      try {
        const connected = r.boolean('connected')
        const name = r.optionalString('name')

        if (name !== binding.expectedName) return interrupted(binding, 'Device name reading is interrupted or changed')
        const values = telemetry(r)
        const partial = r.partial || !device.availability.ready && device.availability.reason === 'refreshing'
        const hold = holds.find(hold => hold.deviceId === binding.providerDeviceId)
        const message = hold?.reason ?? (!device.availability.ready ? device.availability.message : undefined)

        let observation: EquipmentObservation = {
          state: partial ? 'partial' : 'current',
          observedAt: r.observedAt(),
          commandReady: device.availability.ready && !hold,
        }

        if (message) observation = { ...observation, message }

        if (hold) observation = { ...observation, hold: { deviceId: hold.deviceId, reason: hold.reason } }

        const warning = warnings.find(warning => warning.deviceId === binding.providerDeviceId)

        if (warning) observation = { ...observation, warning: { deviceId: warning.deviceId, reason: warning.reason, since: new Date(warning.since).toISOString() } }

        const inspection: EquipmentInspection = {
          providerDeviceId: binding.providerDeviceId,
          kind: kinds[binding.kind],
          configuredName: binding.expectedName,
          name: device.name,
          connection: connected ? 'connected' : 'disconnected',
          telemetry: connected ? { availability: partial ? 'partial' : 'complete', values } : { availability: 'unavailable' },
          observation,
        }

        const interruptedAt = interruptions.get(binding.id)

        if (interruptedAt !== undefined) {
          tracer.startSpan('cria.observation.recovered', { attributes: { 'cria.device.id': binding.id, 'cria.interrupted.ms': Date.now() - interruptedAt } }).end()
          interruptions.delete(binding.id)
        }

        previous.set(binding.id, inspection)

        return inspection
      } catch (error) {
        if (!(error instanceof EquipmentError)) throw error

        return interrupted(binding, error.message)
      }
    })
  }

  return {
    async listDevices() {
      return (await inspections()).map(device => {
        let result: EquipmentDevice = {
          providerDeviceId: device.providerDeviceId,
          kind: device.kind,
          name: device.name,
          connection: device.observation?.state === 'interrupted' ? 'unavailable' : device.connection,
          driver: {},
        }

        if (device.observation) result = { ...result, observation: device.observation }

        return result
      })
    },
    inspectDevices: options => inspections(options?.signal),
    async connectDevice(deviceId, options) {
      const selected = bindings.find(binding => binding.providerDeviceId === deviceId)

      if (!selected) return { outcome: 'failed', reason: 'device-not-found' }
      const equipment = remote()
      const received = Effect.runSync(equipment.received)

      if (received.state === 'live') {
        const device = received.snapshot.devices.find(device => device.id === selected.id)
        const held = Effect.runSync(equipment.holds).find(hold => hold.deviceId === deviceId)

        if (held) return { outcome: 'failed', reason: 'rejected', message: held.reason }

        if (device?.name === selected.expectedName && device.readings.connected.status === 'fresh' && device.readings.connected.value)
          return { outcome: 'connected', command: 'not-needed' }
      }

      const result = await outcomeOf(equipment.run(deviceId, { kind: 'device-connect', parameters: { connected: true } }), options?.signal)

      switch (result.kind) {
        case 'confirmed': return { outcome: 'connected', command: 'requested' }
        case 'failed': return { outcome: 'failed', reason: 'rejected', message: result.message }
        case 'uncertain': return { outcome: 'uncertain', reason: 'write-outcome-unknown' }
        case 'stopped': return { outcome: 'uncertain', reason: 'cancelled' }
      }
    },
  }
}

function telemetry(r: DeviceReadings): DeviceTelemetry {
  switch (r.device.kind) {
    case 'camera': {
      const activity = r.optionalString('activity')
      const sensorTemperatureC = r.optionalNumber('temperatureC')
      const coolerOn = r.optionalBoolean('coolerOn')

      let result: Extract<DeviceTelemetry, { kind: 'camera' }> = { kind: 'camera' }

      if (activity === 'idle' || activity === 'exposing') result = { ...result, activity }

      if (sensorTemperatureC !== undefined) result = { ...result, sensorTemperatureC }

      if (coolerOn !== undefined) {
        const setpointC = r.device.kind === 'camera' ? r.device.lastCommandedSetpointC?.value : undefined
        const powerPercent = r.optionalNumber('coolerPowerPercent')
        const setpointControl = r.optionalBoolean('canSetTemperature')
        const powerReporting = r.optionalBoolean('canGetCoolerPower')

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
      const slewing = r.optionalBoolean('slewing')
      const tracking = r.optionalBoolean('tracking')

      let result: Extract<DeviceTelemetry, { kind: 'telescope' }> = { kind: 'telescope' }

      if (parked !== undefined) result = { ...result, parked }

      if (slewing !== undefined) result = { ...result, slewing }

      if (tracking !== undefined) result = { ...result, tracking }

      return result
    }

    case 'focuser': {
      const position = r.optionalInteger('position')
      const minStep = r.optionalInteger('minStep')
      const maxStep = r.optionalInteger('maxStep')
      const moving = r.optionalBoolean('moving')
      const temperatureC = r.optionalNumber('temperatureC')

      let result: Extract<DeviceTelemetry, { kind: 'focuser' }> = { kind: 'focuser' }

      if (position !== undefined) result = { ...result, position }

      if (minStep !== undefined) result = { ...result, minStep }

      if (maxStep !== undefined) result = { ...result, maxStep }

      if (moving !== undefined) result = { ...result, moving }

      if (temperatureC !== undefined) result = { ...result, temperatureC }

      return result
    }

    case 'weather': {
      const temperatureC = r.optionalNumber('temperatureC')
      const humidityPercent = r.optionalNumber('humidityPercent')
      const dewPointC = r.optionalNumber('dewPointC')

      let result: Extract<DeviceTelemetry, { kind: 'observing-conditions' }> = { kind: 'observing-conditions' }

      if (temperatureC !== undefined) result = { ...result, temperatureC }

      if (humidityPercent !== undefined) result = { ...result, humidityPercent }

      if (dewPointC !== undefined) result = { ...result, dewPointC }

      return result
    }

    case 'switch': {
      const channels: SwitchChannel[] = []

      for (const readings of r.device.kind === 'switch' ? r.device.channels : []) {
        const channel = new DeviceReadings(r.device, readings)
        const id = channel.optionalInteger('id')

        if (id === undefined) {
          r.include(channel)
          continue
        }

        const name = channel.optionalString('name') ?? `Channel ${id}`
        const value = channel.optionalNumber('value')
        const on = channel.optionalBoolean('on')

        let result: SwitchChannel = { id, name }

        if (value !== undefined) result = { ...result, value }

        if (on !== undefined) result = { ...result, on }

        for (const key of ['minimum', 'maximum', 'step'] as const) {
          const limit = channel.advisoryNumber(key)

          if (limit !== undefined) result = { ...result, [key]: limit }
        }

        channels.push(result)
        r.include(channel)
      }

      return { kind: 'switch', channels }
    }
  }
}
