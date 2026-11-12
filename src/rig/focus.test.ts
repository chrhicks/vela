import { describe, expect, it } from 'vitest'
import { StreamPosition, type Entry } from '../../state/entry.ts'
import { makeFocusDrift } from './focus.ts'

function wire(at: number, type: string, property: string, elements: Record<string, number>, state = 'Ok', device = 'focuser'): Entry {
  return { seq: StreamPosition.make(0), kind: 'wire', at, body: { dir: 'in', device, type, property, state, elements } }
}

describe('focus drift', () => {
  it('remembers the focuser temperature when focus was last set, and the temperature now', () => {
    const drift = makeFocusDrift('focuser')

    drift.observe(wire(1, 'def', 'ABS_FOCUS_POSITION', { FOCUS_ABSOLUTE_POSITION: 32000 }))
    drift.observe(wire(2, 'set', 'FOCUS_TEMPERATURE', { TEMPERATURE: 9.5 }))
    expect(drift.view()).toEqual({ now: { celsius: 9.5, at: 2 }, focused: undefined })

    drift.observe(wire(3, 'set', 'ABS_FOCUS_POSITION', { FOCUS_ABSOLUTE_POSITION: 32100 }, 'Busy'))
    drift.observe(wire(4, 'set', 'ABS_FOCUS_POSITION', { FOCUS_ABSOLUTE_POSITION: 32200 }))
    drift.observe(wire(5, 'set', 'FOCUS_TEMPERATURE', { TEMPERATURE: 7 }))

    expect(drift.view()).toEqual({ now: { celsius: 7, at: 5 }, focused: { position: 32200, at: 4, celsius: 9.5 } })
  })

  it('does not count a repeated position as a new focus, and forgets everything when the rig program restarts', () => {
    const drift = makeFocusDrift('focuser')

    drift.observe(wire(1, 'def', 'ABS_FOCUS_POSITION', { FOCUS_ABSOLUTE_POSITION: 32000 }))
    drift.observe(wire(2, 'set', 'ABS_FOCUS_POSITION', { FOCUS_ABSOLUTE_POSITION: 32000 }))
    expect(drift.view().focused).toBeUndefined()

    drift.observe(wire(3, 'set', 'ABS_FOCUS_POSITION', { FOCUS_ABSOLUTE_POSITION: 31000 }))
    expect(drift.view().focused?.position).toBe(31000)

    drift.observe({ seq: StreamPosition.make(0), kind: 'client.connected', at: 4, body: {} })
    expect(drift.view()).toEqual({ now: undefined, focused: undefined })
  })

  it('ignores other devices', () => {
    const drift = makeFocusDrift('focuser')

    drift.observe(wire(1, 'set', 'FOCUS_TEMPERATURE', { TEMPERATURE: 3 }, 'Ok', 'mount'))
    expect(drift.view().now).toBeUndefined()
  })
})
