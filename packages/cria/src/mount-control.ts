import { Effect } from 'effect'
import type { MountControl, MountControlCommand, MountControlCommandResult, MountControlObservation } from '@vela/equipment'
import { outcomeOf, type CriaConnection } from './connection.js'
import { createCriaEquipment as createRemoteEquipment } from './v5/equipment.js'
import type { CriaEquipmentBinding } from './equipment.js'
import type { MountHome } from './mount-home.js'
import { DeviceReadings } from './readings.js'

export function createCriaMountControl(
  connection: CriaConnection,
  bindings: ReadonlyArray<CriaEquipmentBinding>,
  home: MountHome,
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
    const keys = ['parked', 'tracking', 'slewing', 'canUnpark', 'canSetTracking', 'canFindHome'] as const
    const measured: string[] = []

    for (const key of keys) {
      const metadata = key.startsWith('can')
      const value = readings.optionalBoolean(key)

      if (value === undefined) continue
      Object.assign(observation, { [key]: value })

      if (!metadata) measured.push(key)
    }

    if (measured.length) observation = { ...observation, observedAt: readings.observedAt(measured) }

    // A slew someone else started also leaves the last home behind.
    if (observation.slewing === true) home.forget(id)
    const homeConfirmedAt = home.confirmedAt(id)

    return homeConfirmedAt ? { ...observation, homeConfirmedAt } : observation
  }

  /** A halt needs no readings: Cria admits it on a busy or held mount, and sending it twice only stops motion twice. */
  async function stop(telescopeId: string): Promise<MountControlCommandResult> {
    const result = await outcomeOf(remote().halt(telescopeId, 'mount-stop'))

    switch (result.kind) {
      case 'confirmed': return { outcome: 'confirmed', observation: { ...await observe(telescopeId).catch(() => undefined), slewing: false } }
      case 'uncertain': return { outcome: 'uncertain', reason: 'write-outcome-unknown', message: result.message }
      case 'stopped': return { outcome: 'uncertain', reason: 'cancelled' }
      case 'failed': return { outcome: 'failed', reason: 'rejected', message: result.message }
    }
  }

  async function execute(command: MountControlCommand): Promise<MountControlCommandResult> {
    const selected = binding(command.telescopeId)

    if (!selected) return { outcome: 'failed', reason: 'device-not-found' }

    if (command.kind === 'stop') return stop(command.telescopeId)
    command.signal?.throwIfAborted()
    const before = await observe(command.telescopeId, command.signal)

    if (!before) return { outcome: 'failed', reason: 'unavailable', message: 'Fresh mount state is unavailable or the controller is busy.' }

    if (before.slewing === true) return { outcome: 'failed', reason: 'busy', message: 'Wait for mount motion to stop.' }

    if (before.slewing !== false) return { outcome: 'failed', reason: 'unavailable', message: 'Mount motion state is unavailable.' }
    const capability = { unpark: before.canUnpark, 'set-tracking': before.canSetTracking, home: before.canFindHome }[command.kind]

    if (capability !== true) return { outcome: 'failed', reason: capability === false ? 'unsupported' : 'unavailable' }

    if (before.parked === undefined || command.kind === 'set-tracking' && before.tracking === undefined)
      return { outcome: 'failed', reason: 'unavailable', message: 'Mount parked or tracking state is unavailable.' }

    if (command.kind === 'set-tracking' && command.tracking && before.parked)
      return { outcome: 'failed', reason: 'parked', message: 'Unpark the mount before turning tracking on.' }

    if (command.kind === 'home' && before.parked) return { outcome: 'failed', reason: 'parked', message: 'Unpark the mount before homing.' }

    // The AM5 reports no at-home state, so a home is always sent.
    if (command.kind !== 'home' && (command.kind === 'unpark' && before.parked === false || matches(command, before)))
      return { outcome: 'confirmed', observation: before }

    if (command.kind === 'home') home.forget(command.telescopeId)
    const result = await outcomeOf(remote().run(command.telescopeId, operationFor(command)), command.signal)

    switch (result.kind) {
      case 'confirmed': {
        const { observedAt: _, ...facts } = before

        if (command.kind === 'home') {
          home.confirm(command.telescopeId)

          return { outcome: 'confirmed', observation: { ...facts, slewing: false, homeConfirmedAt: home.confirmedAt(command.telescopeId)! } }
        }

        const observation = command.kind === 'unpark'
          ? { ...facts, parked: false, slewing: false }
          : { ...facts, tracking: command.tracking, slewing: false }

        return { outcome: 'confirmed', observation }
      }

      case 'uncertain': return { outcome: 'uncertain', reason: 'write-outcome-unknown', message: result.message }

      case 'stopped':
        return command.kind === 'home'
          ? { outcome: 'failed', reason: 'stopped', message: 'Homing was stopped. The mount is not held; check where it stands before moving it.' }
          : { outcome: 'uncertain', reason: 'cancelled' }

      case 'failed': return { outcome: 'failed', reason: 'rejected', message: result.message }
    }
  }

  return { canStop: true, observe, execute }
}

type Move = Exclude<MountControlCommand, { kind: 'stop' }>

function operationFor(command: Move) {
  switch (command.kind) {
    case 'unpark': return { kind: 'mount-unpark', parameters: {} } as const
    case 'home': return { kind: 'mount-home', parameters: {} } as const
    case 'set-tracking': return { kind: 'mount-tracking', parameters: { tracking: command.tracking } } as const
  }
}

function matches(command: Exclude<MountControlCommand, { kind: 'home' | 'stop' }>, observation: MountControlObservation) {
  return observation.slewing === false && (command.kind === 'unpark'
    ? observation.parked === false && observation.tracking !== undefined
    : observation.tracking === command.tracking && observation.parked !== undefined &&
      (!command.tracking || observation.parked === false))
}
