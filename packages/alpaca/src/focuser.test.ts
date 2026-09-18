import type { ResponseFixture } from './internal/test-fixtures.js'
import { describe, expect, it } from 'vitest'
import { AlpacaFocuserStoppedError, createAlpacaFocuser } from './focuser.js'

function observatory(requestTimeoutMs = 100) {
  const values: Record<string, ResponseFixture> = {
    connected: true, absolute: true, position: 32842, maxstep: 60000, ismoving: false,
  }
  const writes: { operation: string, parameters: URLSearchParams }[] = []
  let started!: () => void
  const whenStarted = new Promise<void>(resolve => { started = resolve })
  const state = { loseMove: false, stopFails: false, onMove: () => {} }

  const fetch: typeof globalThis.fetch = async (input, init) => {
    init?.signal?.throwIfAborted()
    const operation = new URL(String(input)).pathname.split('/').at(-1)!
    const envelope = (Value?: ResponseFixture, ErrorNumber = 0) => Response.json({
      ClientTransactionID: 0, ServerTransactionID: 1, ErrorNumber, ErrorMessage: '', Value,
    })

    if (operation === 'configureddevices') {
      return envelope([{ DeviceName: 'EAF', DeviceType: 'Focuser', DeviceNumber: 0, UniqueID: 'eaf-id' }])
    }

    if (init?.method === 'PUT') {
      const parameters = new URLSearchParams(String(init.body))
      writes.push({ operation, parameters })

      if (operation === 'position') {
        values.ismoving = true
        started()
        values.position = Number(parameters.get('Position'))
        state.onMove()

        if (state.loseMove) throw new TypeError('Response lost after move started')
      } else if (operation === 'halt') {
        if (state.stopFails) throw new TypeError('Halt unreachable')
        values.ismoving = false
      } else throw new Error(`Unexpected write ${operation}`)

      return envelope()
    }

    if (!(operation in values)) throw new Error(`Unexpected read ${operation}`)

    return envelope(values[operation])
  }

  const focuser = createAlpacaFocuser({ baseUrl: 'http://fake', fetch, requestTimeoutMs, pollIntervalMs: 1, moveTimeoutMs: 100 })

  return { focuser, values, writes, state, whenStarted }
}

const window = { minPosition: 32642, maxPosition: 33042 }

describe('focuser write boundary', () => {
  it('moves to a window position, waits until stopped, and reads back the position', async () => {
    const fake = observatory()
    const result = fake.focuser.move({ focuserId: 'eaf-id', position: 33042, window })
    await fake.whenStarted
    fake.values.ismoving = false
    expect(await result).toEqual({ position: 33042 })
    expect(fake.writes.map(write => write.operation)).toEqual(['position'])
    expect(fake.writes[0]!.parameters.get('Position')).toBe('33042')
  })

  it('never commands Move(0) or a position at MaxStep', async () => {
    const fake = observatory()
    await expect(fake.focuser.move({ focuserId: 'eaf-id', position: 0, window: { minPosition: 0, maxPosition: 100 } })).rejects.toThrow(/not a home/)
    await expect(fake.focuser.move({ focuserId: 'eaf-id', position: 60000, window: { minPosition: 1, maxPosition: 60000 } })).rejects.toThrow(/mechanical travel limit/)
    expect(fake.writes).toEqual([])
  })

  it('refuses a target outside the walk window before writing', async () => {
    const fake = observatory()
    await expect(fake.focuser.move({ focuserId: 'eaf-id', position: 30000, window })).rejects.toThrow(/window around the starting position/)
    expect(fake.writes).toEqual([])
  })

  it('treats a lost move response as success only when inspection shows the target, and never replays', async () => {
    const arrived = observatory()
    arrived.state.loseMove = true
    expect(await arrived.focuser.move({ focuserId: 'eaf-id', position: 33042, window })).toEqual({ position: 33042 })
    expect(arrived.writes.filter(write => write.operation === 'position')).toHaveLength(1)

    const missed = observatory()
    missed.state.loseMove = true
    missed.state.onMove = () => { missed.values.position = 32842 }
    await expect(missed.focuser.move({ focuserId: 'eaf-id', position: 33042, window })).rejects.toThrow(/did not confirm the commanded position/)
    expect(missed.writes.map(write => write.operation)).toEqual(['position', 'halt'])
    expect(missed.writes.filter(write => write.operation === 'position')).toHaveLength(1)
  })

  it('cancels only after independent halt confirmation', async () => {
    const fake = observatory()
    const controller = new AbortController()
    const assertion = expect(fake.focuser.move({ focuserId: 'eaf-id', position: 33042, window, signal: controller.signal })).rejects.toBeInstanceOf(AlpacaFocuserStoppedError)
    await fake.whenStarted
    controller.abort()
    await assertion
    expect(fake.values.ismoving).toBe(false)
    expect(fake.writes.map(write => write.operation)).toEqual(['position', 'halt'])
  })

  it('skips a write when the focuser is already at the target', async () => {
    const fake = observatory()
    expect(await fake.focuser.move({ focuserId: 'eaf-id', position: 32842, window })).toEqual({ position: 32842 })
    expect(fake.writes).toEqual([])
  })
})
