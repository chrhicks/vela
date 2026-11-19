import { describe, expect, it } from 'vitest'
import { isPressed, pressedSince, pressKey } from './pressing.ts'
import { entry, foldRig, velaStarted } from './testing.ts'

const pressed = (id: string, command: string, at: number, request: Readonly<Record<string, unknown>> = { command }) => entry('vela.command.pressed', at, { id, command, key: pressKey(request) })
const answered = (id: string, command: string, at: number) => entry('vela.command.answered', at, { id, command })

describe('commands pressed on any page', () => {
  it('holds a press until its answer comes', () => {
    const waiting = foldRig([pressed('a', 'home', 100), pressed('b', 'autofocus', 110), answered('b', 'autofocus', 120)]).pressing

    expect(waiting).toEqual({ a: { command: 'home', key: pressKey({ command: 'home' }), at: 100 } })
    expect(isPressed(waiting, pressKey({ command: 'home' }))).toBe(true)
    expect(isPressed(waiting, pressKey({ command: 'autofocus' }))).toBe(false)
  })

  it('does not count a press from before the service last started, whose answer was never written', () => {
    const waiting = foldRig([pressed('a', 'home', 100)]).pressing

    expect(pressedSince(waiting, 101)).toEqual({})
    expect(pressedSince(waiting, 100)).toEqual(waiting)
  })

  it('tells presses of one command with different values apart, whatever order the request was written in', () => {
    const waiting = foldRig([pressed('a', 'focusBy', 100, { steps: 50, command: 'focusBy' })]).pressing

    expect(isPressed(waiting, pressKey({ command: 'focusBy', steps: 50 }))).toBe(true)
    expect(isPressed(waiting, pressKey({ command: 'focusBy', steps: -50 }))).toBe(false)
  })

  it('drops every press waiting for an answer when Vela starts again, and holds a press made after', () => {
    const waiting = foldRig([pressed('a', 'home', 100), pressed('b', 'autofocus', 110), velaStarted(200)]).pressing

    expect(waiting).toEqual({})
    expect(foldRig([pressed('a', 'home', 100), velaStarted(200), pressed('c', 'stop', 210)]).pressing).toEqual({ c: { command: 'stop', key: pressKey({ command: 'stop' }), at: 210 } })
  })
})
