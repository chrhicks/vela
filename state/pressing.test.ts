import { describe, expect, it } from 'vitest'
import { isPressed, pressedSince } from './pressing.ts'
import { entry, foldRig } from './testing.ts'

const pressed = (id: string, command: string, at: number) => entry('vela.command.pressed', at, { id, command })
const answered = (id: string, command: string, at: number) => entry('vela.command.answered', at, { id, command })

describe('commands pressed on any page', () => {
  it('holds a press until its answer comes', () => {
    const waiting = foldRig([pressed('a', 'home', 100), pressed('b', 'autofocus', 110), answered('b', 'autofocus', 120)]).pressing

    expect(waiting).toEqual({ a: { command: 'home', at: 100 } })
    expect(isPressed(waiting, 'home')).toBe(true)
    expect(isPressed(waiting, 'autofocus')).toBe(false)
  })

  it('does not count a press from before the service last started, whose answer was never written', () => {
    const waiting = foldRig([pressed('a', 'home', 100)]).pressing

    expect(pressedSince(waiting, 101)).toEqual({})
    expect(pressedSince(waiting, 100)).toEqual(waiting)
  })
})
