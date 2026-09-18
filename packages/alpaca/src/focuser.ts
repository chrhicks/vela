import { setTimeout as delay } from 'node:timers/promises'
import { AlpacaProviderError } from './error.js'
import { createAlpacaClient } from './internal/client.js'
import { rejectDuplicateDeviceIds, stableDeviceId } from './internal/configured-device.js'
import type { ConfiguredDevice } from './internal/types/management.js'

export interface FocuserTravelWindow {
  minPosition: number
  maxPosition: number
}

export interface AlpacaFocuserStatus {
  absolute: boolean
  position: number
  maxStep: number
  moving: boolean
}

export interface AlpacaFocuserMove {
  focuserId: string
  position: number
  window: FocuserTravelWindow
  signal?: AbortSignal
}

export interface AlpacaFocuserOptions {
  baseUrl: string
  fetch?: typeof globalThis.fetch
  requestTimeoutMs?: number
  moveTimeoutMs?: number
  pollIntervalMs?: number
}

export interface AlpacaFocuser {
  status(focuserId: string, signal?: AbortSignal): Promise<AlpacaFocuserStatus>
  move(command: AlpacaFocuserMove): Promise<{ position: number }>
  halt(focuserId: string): Promise<void>
}

export class AlpacaFocuserStoppedError extends Error {
  constructor() {
    super('Focuser move cancellation confirmed')
    this.name = 'AbortError'
  }
}

function invalid(message: string, endpoint: string): never {
  throw new AlpacaProviderError(message, { reason: 'invalid-response', endpoint })
}

export function createAlpacaFocuser({
  baseUrl,
  fetch = globalThis.fetch,
  requestTimeoutMs = 5_000,
  moveTimeoutMs = 60_000,
  pollIntervalMs = 100,
}: AlpacaFocuserOptions): AlpacaFocuser {
  for (const value of [requestTimeoutMs, moveTimeoutMs, pollIntervalMs]) {
    if (!Number.isInteger(value) || value <= 0) throw new RangeError('Focuser timeouts and poll interval must be positive integers')
  }

  const client = createAlpacaClient({ baseUrl, fetch, requestTimeoutMs })

  async function device(focuserId: string, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const devices = await client.configuredDevices(signal)
    rejectDuplicateDeviceIds(devices)
    const found = devices.find(candidate => stableDeviceId(candidate) === focuserId && candidate.DeviceType.toLowerCase() === 'focuser')

    if (!found) throw new Error(`Configured focuser ${focuserId} was not found`)

    if (!(await client.connected(found, signal))) throw new Error('Focuser is disconnected')

    return found
  }

  async function readStatus(focuser: ConfiguredDevice, signal?: AbortSignal): Promise<AlpacaFocuserStatus> {
    const absolute = await client.readBoolean(focuser, 'absolute', signal)
    const position = await client.readNumber(focuser, 'position', signal)
    const maxStep = await client.readNumber(focuser, 'maxstep', signal)
    const moving = await client.readBoolean(focuser, 'ismoving', signal)

    if (typeof absolute !== 'boolean' || typeof moving !== 'boolean') invalid('Invalid focuser motion state', 'ismoving')

    if (!Number.isSafeInteger(position) || !Number.isSafeInteger(maxStep) || maxStep < 1 || position < 0 || position > maxStep) {
      invalid('Invalid focuser position', 'position')
    }

    return { absolute, position, maxStep, moving }
  }

  function rejectUnsafeTarget(target: number, status: AlpacaFocuserStatus, window: FocuserTravelWindow) {
    if (target === 0) throw new Error('Focuser position 0 is a mechanical stop, not a home. Vela will not command Move(0).')

    if (!Number.isSafeInteger(target) || target < 1 || target > status.maxStep - 1) {
      throw new Error('That focuser move would approach a mechanical travel limit. Vela will not command it.')
    }

    if (target < window.minPosition || target > window.maxPosition) {
      throw new Error('That focuser move would leave the autofocus window around the starting position.')
    }
  }

  async function waitStopped(focuser: ConfiguredDevice, signal: AbortSignal) {
    while (true) {
      signal.throwIfAborted()

      if (!(await client.connected(focuser, signal))) throw new Error('Focuser disconnected before stop could be confirmed')

      if (!(await client.readBoolean(focuser, 'ismoving', signal))) return
      await delay(pollIntervalMs, undefined, { signal })
    }
  }

  async function stop(focuser: ConfiguredDevice) {
    const signal = AbortSignal.timeout(Math.min(moveTimeoutMs, 15_000))
    let commandError: unknown

    try { await client.command(focuser, 'halt', {}, signal) }
    catch (error) { commandError = error }

    try { await waitStopped(focuser, signal) }
    catch (error) {
      throw new AggregateError(commandError === undefined ? [error] : [commandError, error], 'Focuser stop could not be confirmed')
    }
  }

  return {
    async status(focuserId, signal) {
      return readStatus(await device(focuserId, signal), signal)
    },

    async move({ focuserId, position, window, signal }) {
      const focuser = await device(focuserId, signal)
      const before = await readStatus(focuser, signal)

      if (!before.absolute) throw new Error('Autofocus needs an absolute focuser')

      if (before.moving) throw new Error('Focuser is already moving')
      rejectUnsafeTarget(position, before, window)

      if (before.position === position) return { position }

      signal?.throwIfAborted()
      const deadline = AbortSignal.timeout(moveTimeoutMs)
      const operation = signal ? AbortSignal.any([signal, deadline]) : deadline

      try {
        await client.command(focuser, 'position', { Position: String(position) }, operation)
        await waitStopped(focuser, operation)
        const after = await readStatus(focuser, operation)

        if (after.position !== position) throw new Error('Focuser did not arrive at the commanded position')

        return { position: after.position }
      } catch (error) {
        try { await stop(focuser) }
        catch (stopError) {
          if (signal?.aborted) throw stopError
          throw error
        }

        if (signal?.aborted) throw new AlpacaFocuserStoppedError()
        const observed = await readStatus(focuser).catch(() => undefined)

        if (observed?.position === position && !observed.moving) return { position }

        throw new Error('The focuser did not confirm the commanded position. Vela did not repeat the move.', { cause: error })
      }
    },

    async halt(focuserId) {
      await stop(await device(focuserId))
    },
  }
}
