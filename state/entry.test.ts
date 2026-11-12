import { describe, expect, it } from 'vitest'
import { commandSubject, readMessage, readWireBody } from './entry.ts'

describe('readMessage', () => {
  it('reads an entry with its stream position', () => {
    const text = JSON.stringify({ v: 2, id: 'wire:1', rig: 'phoenix', kind: 'wire', at: 5, source: 'rig:rig', body: { dir: 'in', device: 'mount', type: 'set', property: 'TELESCOPE_PARK', elements: { PARK: true } } })

    expect(readMessage({ seq: 41, subject: 'rig-dev.wire.mount', time: 6, text })).toEqual({ seq: 41, kind: 'wire', at: 5, body: expect.any(Object) })
  })

  it('reads a command request as an entry, with the device from its subject and the time from the broker', () => {
    const text = JSON.stringify({ id: 'vela-1', property: 'ABS_FOCUS_POSITION', values: { FOCUS_ABSOLUTE_POSITION: 1200 }, by: 'vela' })

    expect(readMessage({ seq: 42, subject: commandSubject('focuser'), time: 9000, text })).toEqual({
      seq: 42,
      kind: 'command',
      at: 9000,
      body: { id: 'vela-1', property: 'ABS_FOCUS_POSITION', values: { FOCUS_ABSOLUTE_POSITION: 1200 }, by: 'vela', device: 'focuser' },
    })
  })

  it('refuses text that is not an entry or a request', () => {
    expect(readMessage({ seq: 1, subject: 'rig-dev.client', time: 0, text: 'not json' })).toBeUndefined()
    expect(readMessage({ seq: 1, subject: 'rig-dev.client', time: 0, text: '[]' })).toBeUndefined()
    expect(readMessage({ seq: 1, subject: 'rig-dev.client', time: 0, text: JSON.stringify({ kind: 'wire' }) })).toBeUndefined()
    expect(readMessage({ seq: 1, subject: commandSubject('mount'), time: 0, text: 'not json' })).toBeUndefined()
  })
})

describe('readWireBody', () => {
  it('keeps the elements that are numbers, switches or text and drops the rest', () => {
    const wire = readWireBody({ dir: 'in', device: 'mount', type: 'set', property: 'P', state: 'Ok', elements: { A: 1, B: true, C: 'x', D: null, E: { nested: 1 } }, perm: 'rw', numbers: { A: { min: 0, max: 1, step: 1, format: '%g' } } })

    expect(wire).toEqual({ dir: 'in', device: 'mount', type: 'set', property: 'P', state: 'Ok', elements: { A: 1, B: true, C: 'x' }, limits: { A: { min: 0, max: 1 } } })
  })

  it('refuses a body without a direction or device', () => {
    expect(readWireBody({ device: 'mount', type: 'set' })).toBeUndefined()
    expect(readWireBody('text')).toBeUndefined()
  })
})
