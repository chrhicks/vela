import { describe, expect, it } from 'vitest'
import { deviceBringUp, guiderHeard, rigProgramUp } from './bring-up.ts'
import { emptyRig, rig } from './rig.ts'
import { entry, fold } from './testing.ts'
import { writes, type Writes } from './writes.ts'

const reported = (device: string, property: string, elements: Readonly<Record<string, number | boolean | string>>, at = 1, type = 'set', state = 'Ok') =>
  entry('wire', at, { dir: 'in', device, type, property, state, elements })

const written = (device: string, property: string, elements: Readonly<Record<string, number | boolean | string>>, at = 1) => entry('wire', at, { dir: 'out', device, type: 'new', property, elements })

const connected = (device: string) => reported(device, 'CONNECTION', { CONNECT: true, DISCONNECT: false })

describe('writes', () => {
  const reduce = (entries: Parameters<typeof fold>[2]) => fold<Writes>(writes, {}, entries)

  it("keeps the rig program's write until the device answers it, through a busy answer that does not show it yet", () => {
    const pending = reduce([written('primary', 'CCD_TEMPERATURE', { CCD_TEMPERATURE_VALUE: -10 }, 5)])

    expect(pending).toEqual({ primary: { CCD_TEMPERATURE: { values: { CCD_TEMPERATURE_VALUE: -10 }, at: 5 } } })
    expect(fold(writes, pending, [reported('primary', 'CCD_TEMPERATURE', { CCD_TEMPERATURE_VALUE: 4.2 }, 6, 'set', 'Busy')])).toBe(pending)
    expect(fold(writes, pending, [reported('primary', 'CCD_TEMPERATURE', { CCD_TEMPERATURE_VALUE: -10 }, 7)])).toEqual({ primary: {} })
  })

  it('takes a busy answer that already shows the written values as done, as the camera answers its cooler while it runs', () => {
    const pending = reduce([written('primary', 'CCD_COOLER', { COOLER_ON: true, COOLER_OFF: false }, 5)])

    expect(fold(writes, pending, [reported('primary', 'CCD_COOLER', { COOLER_ON: true, COOLER_OFF: false }, 6, 'set', 'Busy')])).toEqual({ primary: {} })
  })

  it('forgets everything when the rig program reconnects', () => {
    expect(reduce([written('mount', 'TIME_UTC', { UTC: 'x' }), entry('client.connected', 2, { run: 'r' })])).toEqual({})
  })
})

describe('deviceBringUp', () => {
  const state = (entries: Parameters<typeof fold>[2]) => fold(rig, emptyRig, entries)

  it('is waiting until the device is connected', () => {
    expect(deviceBringUp(state([reported('focuser', 'CONNECTION', { CONNECT: false, DISCONNECT: true })]), 'focuser')).toEqual({ status: 'waiting', changes: [] })
    expect(deviceBringUp(state([]), 'box')).toEqual({ status: 'waiting', changes: [] })
  })

  it('is setting while a needed reading is missing or a write is unanswered, and lists what changes', () => {
    const before = [connected('primary'), reported('primary', 'CCD_CONTROLS', { Gain: 200, Offset: 1 }), reported('primary', 'CCD_TEMPERATURE', { CCD_TEMPERATURE_VALUE: 20 }), reported('primary', 'CCD_COOLER', { COOLER_ON: false, COOLER_OFF: true })]

    expect(deviceBringUp(state([connected('primary')]), 'primary').status).toBe('setting')
    expect(deviceBringUp(state([...before, written('primary', 'CCD_CONTROLS', { Gain: 100, Offset: 1 })]), 'primary')).toEqual({ status: 'setting', changes: [{ property: 'CCD_CONTROLS', element: 'Gain', from: 200, to: 100 }] })
    expect(deviceBringUp(state([...before, written('primary', 'CCD_CONTROLS', { Gain: 100, Offset: 1 }), reported('primary', 'CCD_CONTROLS', { Gain: 100, Offset: 1 })]), 'primary')).toEqual({ status: 'set', changes: [] })
  })

  it('is set for a connected device with nothing needed and nothing pending', () => {
    expect(deviceBringUp(state([connected('box')]), 'box')).toEqual({ status: 'set', changes: [] })
  })

  it('calls the rig program up only while it has been heard recently, and hears PHD2', () => {
    const heard = state([entry('client.connected', 1000, { run: 'r' })])

    expect(rigProgramUp(emptyRig, 2000, 10)).toBe(false)
    expect(rigProgramUp(heard, 2000, 10)).toBe(true)
    expect(rigProgramUp(heard, 1000 + 11_000, 10)).toBe(false)
    expect(rigProgramUp(heard, undefined, 10)).toBe(false)
    expect(guiderHeard(state([entry('client.connection', 1, { target: 'phd2', status: 'connected' })]))).toBe(true)
  })
})
