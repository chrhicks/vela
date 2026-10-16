import { Effect } from 'effect'
import type { MountControl, MountControlCommand, MountControlCommandResult, MountControlObservation } from '@vela/equipment'
import { outcomeOf, type CriaConnection } from './connection.js'
import { createCriaEquipment as createRemoteEquipment } from './v5/equipment.js'
import type { CriaEquipmentBinding } from './equipment.js'
import { DeviceReadings } from './readings.js'

export function createCriaMountControl(
  connection: CriaConnection,
  bindings: ReadonlyArray<CriaEquipmentBinding>,
): MountControl {
  const remote = () => createRemoteEquipment(connection.session(), bindings.map(binding => ({
    deviceId: binding.providerDeviceId, criaDeviceId: binding.id, expectedName: binding.expectedName,
  })))

  function binding(id: string) {
    return bindings.find(device => device.providerDeviceId === id && device.kind === 'mount')
  }

  async function observe(id: string, signal?: AbortSignal): Promise<MountControlObservation | undefined> {
    const selected = binding(id)

    if (!selected) return undefined
    signal?.throwIfAborted()
    const received = Effect.runSync(connection.session().received)

    if (received.state !== 'live') return undefined
    const snapshot = received.snapshot
    const device = snapshot.devices.find(device => device.id === selected.id)

    if (!device || device.kind !== 'mount' || device.name !== selected.expectedName) return undefined
    const held = Effect.runSync(remote().holds).find(hold => hold.deviceId === id)

    if (held) return undefined

    if (!device.availability.ready || device.quarantine.held || snapshot.operations.some(operation =>
      operation.failureDomain === device.failureDomain && operation.state !== 'settled'))
      return undefined
    const readings = new DeviceReadings(device)
    let observation: MountControlObservation = {}
    const keys = ['parked', 'tracking', 'slewing', 'canUnpark', 'canSetTracking'] as const
    const measured: string[] = []

    for (const key of keys) {
      const metadata = key === 'canUnpark' || key === 'canSetTracking'
      const value = readings.optionalBoolean(key)

      if (value === undefined) continue
      Object.assign(observation, { [key]: value })

      if (!metadata) measured.push(key)
    }

    if (measured.length) observation = { ...observation, observedAt: readings.observedAt(measured) }

    return observation
  }

  async function execute(command: MountControlCommand): Promise<MountControlCommandResult> {
    const selected = binding(command.telescopeId)

    if (!selected) return { outcome: 'failed', reason: 'device-not-found' }

    command.signal?.throwIfAborted()
    const before = await observe(command.telescopeId, command.signal)

    if (!before) return { outcome: 'failed', reason: 'unavailable', message: 'Fresh mount state is unavailable or the controller is busy.' }

    if (before.slewing === true) return { outcome: 'failed', reason: 'busy', message: 'Wait for mount motion to stop.' }

    if (before.slewing !== false) return { outcome: 'failed', reason: 'unavailable', message: 'Mount motion state is unavailable.' }
    const capability = command.kind === 'unpark' ? before.canUnpark : before.canSetTracking

    if (capability !== true) return { outcome: 'failed', reason: capability === false ? 'unsupported' : 'unavailable' }

    if (before.parked === undefined || command.kind === 'set-tracking' && before.tracking === undefined)
      return { outcome: 'failed', reason: 'unavailable', message: 'Mount parked or tracking state is unavailable.' }

    if (command.kind === 'set-tracking' && command.tracking && before.parked)
      return { outcome: 'failed', reason: 'parked', message: 'Unpark the mount before turning tracking on.' }

    if (command.kind === 'unpark' && before.parked === false || matches(command, before))
      return { outcome: 'confirmed', observation: before }

    const operation = command.kind === 'unpark'
      ? { kind: 'mount-unpark' as const, parameters: {} }
      : { kind: 'mount-tracking' as const, parameters: { tracking: command.tracking } }

    const result = await outcomeOf(remote().run(command.telescopeId, operation), command.signal)

    switch (result.kind) {
      case 'confirmed': {
        const { observedAt: _, ...facts } = before

        const observation = command.kind === 'unpark'
          ? { ...facts, parked: false, slewing: false }
          : { ...facts, tracking: command.tracking, slewing: false }

        return { outcome: 'confirmed', observation }
      }

      case 'uncertain': return { outcome: 'uncertain', reason: 'write-outcome-unknown', message: result.message }
      case 'stopped': return { outcome: 'uncertain', reason: 'cancelled' }
      case 'failed': return { outcome: 'failed', reason: 'rejected', message: result.message }
    }
  }

  return { observe, execute }
}

function matches(command: MountControlCommand, observation: MountControlObservation) {
  return observation.slewing === false && (command.kind === 'unpark'
    ? observation.parked === false && observation.tracking !== undefined
    : observation.tracking === command.tracking && observation.parked !== undefined &&
      (!command.tracking || observation.parked === false))
}
