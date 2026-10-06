import { setTimeout as delay } from 'node:timers/promises'
import type {
  MountControl, MountControlCommand, MountControlCommandResult, MountControlObservation,
} from '@vela/equipment'
import {
  CriaApiError, CriaCancelledError, CriaNotAdmittedError, CriaOperationFailedError,
  CriaUncertainError, type CriaClient,
} from '@vela/cria'
import type { CriaEquipmentBinding } from './equipment.js'
import { DeviceReadings } from './readings.js'

export function createCriaMountControl(
  client: CriaClient,
  bindings: ReadonlyArray<CriaEquipmentBinding>,
): MountControl {
  function binding(id: string) {
    return bindings.find(device => device.providerDeviceId === id && device.kind === 'mount')
  }

  async function observe(id: string, signal?: AbortSignal): Promise<MountControlObservation | undefined> {
    const selected = binding(id)

    if (!selected) return undefined
    const { snapshot, device } = await client.observe(selected.id, signal ? { signal } : {})

    if (!snapshot.state.commandsEnabled || !device.commandReady || snapshot.state.operations.some(operation =>
      operation.failureDomain === device.failureDomain && (!operation.settled || operation.blocksDevice)))
      return undefined
    const readings = new DeviceReadings(client, snapshot, device)
    let observation: MountControlObservation = {}
    const keys = ['parked', 'tracking', 'slewing', 'canUnpark', 'canSetTracking'] as const
    const measured: string[] = []

    for (const key of keys) {
      const metadata = key === 'canUnpark' || key === 'canSetTracking'
      const value = readings.optionalBoolean(key, metadata)

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

    if (command.expectedTelescopeName !== undefined && command.expectedTelescopeName !== selected.expectedName)
      return { outcome: 'failed', reason: 'unavailable', message: 'Mount identity changed.' }
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

    try {
      const operation = command.kind === 'unpark'
        ? { kind: 'mount-unpark' as const, parameters: {} }
        : { kind: 'mount-tracking' as const, parameters: { tracking: command.tracking } }

      await client.run(selected.id, operation, command.signal ? { signal: command.signal } : {})
    } catch (error) {
      if (error instanceof CriaUncertainError)
        return { outcome: 'uncertain', reason: 'write-outcome-unknown', message: error.message }

      if (error instanceof CriaCancelledError)
        return { outcome: 'uncertain', reason: 'cancelled' }

      if (error instanceof CriaOperationFailedError || error instanceof CriaApiError || error instanceof CriaNotAdmittedError)
        return { outcome: 'failed', reason: 'rejected', message: error.message }
      throw error
    }

    // Terminal operation events can precede dynamic field refreshes. These reads
    // inspect the shared SSE cache; they never poll Cria HTTP or replay a command.
    const deadline = performance.now() + 10_000
    const timeout = AbortSignal.timeout(10_000)
    const signal = command.signal ? AbortSignal.any([command.signal, timeout]) : timeout

    try {
      for (;;) {
        const observation = await observe(command.telescopeId, signal)

        if (observation && matches(command, observation)) return { outcome: 'confirmed', observation }

        if (performance.now() >= deadline)
          return { outcome: 'uncertain', reason: 'verification-unavailable' }
        await delay(100, undefined, { signal })
      }
    } catch {
      return { outcome: 'uncertain', reason: command.signal?.aborted ? 'cancelled' : 'verification-unavailable' }
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
