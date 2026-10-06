import { setTimeout as delay } from 'node:timers/promises'
import type {
  MountControl, MountControlCommand, MountControlCommandResult, MountControlObservation,
} from '@vela/equipment'
import { AlpacaProviderError } from './error.js'
import { createAlpacaClient } from './internal/client.js'
import { rejectDuplicateDeviceIds, stableDeviceId } from './internal/configured-device.js'
import type { ConfiguredDevice } from './internal/types/management.js'

export interface AlpacaMountControlOptions {
  readonly baseUrl: string
  readonly fetch?: typeof globalThis.fetch
  readonly requestTimeoutMs?: number
  readonly confirmationTimeoutMs?: number
  readonly pollIntervalMs?: number
}

export function createAlpacaMountControl({
  baseUrl,
  fetch = globalThis.fetch,
  requestTimeoutMs = 5_000,
  confirmationTimeoutMs = 10_000,
  pollIntervalMs = 250,
}: AlpacaMountControlOptions): MountControl {
  for (const value of [requestTimeoutMs, confirmationTimeoutMs, pollIntervalMs]) {
    if (!Number.isInteger(value) || value <= 0) throw new RangeError('Mount control timeouts must be positive integers')
  }

  const client = createAlpacaClient({ baseUrl, fetch, requestTimeoutMs })

  async function telescope(id: string, signal?: AbortSignal) {
    const devices = await client.configuredDevices(signal)
    rejectDuplicateDeviceIds(devices)

    return devices.find(device => stableDeviceId(device) === id && device.DeviceType.toLowerCase() === 'telescope')
  }

  async function optional(device: ConfiguredDevice, key: string, signal?: AbortSignal) {
    try {
      return await client.readBoolean(device, key, signal)
    } catch (error) {
      if (error instanceof AlpacaProviderError && error.reason === 'protocol-error' && error.errorNumber === 1024)
        return undefined
      throw error
    }
  }

  async function read(device: ConfiguredDevice, signal?: AbortSignal): Promise<MountControlObservation> {
    const observation: MountControlObservation = {}
    const observedAt = new Date().toISOString()

    const properties = {
      parked: 'atpark', tracking: 'tracking', slewing: 'slewing',
      canUnpark: 'canunpark', canSetTracking: 'cansettracking',
    } as const

    for (const [key, property] of Object.entries(properties)) {
      const value = await optional(device, property, signal)

      if (value !== undefined) Object.assign(observation, { [key]: value })
    }

    return { ...observation, observedAt }
  }

  async function observe(id: string, signal?: AbortSignal) {
    const device = await telescope(id, signal)

    if (!device || !await client.connected(device, signal)) return undefined
    await client.readString(device, 'name', signal)

    return read(device, signal)
  }

  async function execute(command: MountControlCommand): Promise<MountControlCommandResult> {
    const { signal } = command
    signal?.throwIfAborted()
    const device = await telescope(command.telescopeId, signal)

    if (!device) return { outcome: 'failed', reason: 'device-not-found' }

    if (!await client.connected(device, signal)) return { outcome: 'failed', reason: 'disconnected' }
    const name = (await client.readString(device, 'name', signal)).trim()

    if (!name || command.expectedTelescopeName !== undefined && name !== command.expectedTelescopeName)
      return { outcome: 'failed', reason: 'unavailable', message: 'Mount identity changed or is unavailable.' }
    const before = await read(device, signal)

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

    let ambiguous = false

    try {
      signal?.throwIfAborted()

      if (command.kind === 'unpark') await client.command(device, 'unpark', {}, signal)
      else await client.command(device, 'tracking', { Tracking: String(command.tracking) }, signal)
    } catch (error) {
      if (error instanceof AlpacaProviderError && error.reason === 'protocol-error' && error.errorNumber !== undefined)
        return { outcome: 'failed', reason: 'rejected', message: error.message }
      ambiguous = true
    }

    const deadline = performance.now() + confirmationTimeoutMs
    const timeout = AbortSignal.timeout(confirmationTimeoutMs)
    const verificationSignal = signal ? AbortSignal.any([signal, timeout]) : timeout

    try {
      for (;;) {
        if (signal?.aborted) return { outcome: 'uncertain', reason: 'cancelled' }
        const current = await telescope(command.telescopeId, verificationSignal)

        if (!current || current.DeviceNumber !== device.DeviceNumber ||
          !await client.connected(current, verificationSignal) || (await client.readString(current, 'name', verificationSignal)).trim() !== name)
          return { outcome: 'uncertain', reason: 'verification-unavailable' }
        const observation = await read(current, verificationSignal)

        if (matches(command, observation)) return { outcome: 'confirmed', observation }

        if (performance.now() >= deadline) break
        await delay(pollIntervalMs, undefined, { signal: verificationSignal })
      }
    } catch {
      if (signal?.aborted) return { outcome: 'uncertain', reason: 'cancelled' }

      return { outcome: 'uncertain', reason: ambiguous ? 'write-outcome-unknown' : 'verification-unavailable' }
    }

    return ambiguous
      ? { outcome: 'uncertain', reason: 'write-outcome-unknown' }
      : { outcome: 'failed', reason: 'not-confirmed' }
  }

  return { observe, execute }
}

function matches(command: MountControlCommand, observation: MountControlObservation) {
  return observation.slewing === false && (command.kind === 'unpark'
    ? observation.parked === false && observation.tracking !== undefined
    : observation.tracking === command.tracking && observation.parked !== undefined &&
      (!command.tracking || observation.parked === false))
}
