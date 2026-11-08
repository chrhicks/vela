import { describe, expect, it } from 'vitest'
import { readEntry, readWireBody } from './entry.ts'

describe('readEntry', () => {
  it('reads an entry from before the run id and the control facts were added', () => {
    const text = JSON.stringify({ v: 2, id: 'wire:1', rig: 'phoenix', kind: 'wire', at: 5, source: 'rig:rig', body: { dir: 'in', device: 'mount', type: 'set', property: 'TELESCOPE_PARK', elements: { PARK: true } } })

    expect(readEntry(text)).toEqual({ id: 'wire:1', kind: 'wire', at: 5, run: undefined, body: expect.any(Object) })
  })

  it('reads the run id when the entry has one', () => {
    expect(readEntry(JSON.stringify({ v: 2, id: 'client:1', run: 'r1', kind: 'client.connected', at: 7, body: {} }))?.run).toBe('r1')
  })

  it('refuses text that is not an entry', () => {
    expect(readEntry('not json')).toBeUndefined()
    expect(readEntry('[]')).toBeUndefined()
    expect(readEntry(JSON.stringify({ kind: 'wire' }))).toBeUndefined()
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
