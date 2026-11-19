import { describe, expect, it } from 'vitest'
import type { Command, Outcome } from '../commands/sender.ts'
import { makePicture } from '../rig/picture.ts'
import { startedAt, wire } from '../testing/entries.ts'
import { makeGoto } from './goto.ts'

const target = { raHours: 5.5, decDegrees: 61.25 }

function mountWith(onCoordSet: Record<string, boolean> | undefined, refuse: ReadonlySet<string> = new Set()) {
  const picture = makePicture()
  const sent: Command[] = []
  let at = startedAt

  if (onCoordSet !== undefined) picture.apply(wire((at += 1), 'def', 'primary', 'ON_COORD_SET', onCoordSet, 'Ok'), at)

  const holder = { goto: undefined as ReturnType<typeof makeGoto> | undefined }
  const answer = (state: string) => holder.goto?.observe(wire((at += 1), 'set', 'primary', 'EQUATORIAL_EOD_COORD', { RA: target.raHours, DEC: target.decDegrees }, state))

  holder.goto = makeGoto({
    picture,
    mount: 'primary',
    sender: {
      send: async (command): Promise<Outcome> => {
        sent.push(command)

        return refuse.has(command.property) ? { result: 'refused', reason: `no ${command.property}` } : { result: 'written' }
      },
    },
  })

  return { goto: holder.goto, sent, answer }
}

const tracking = { SLEW: false, TRACK: true, SYNC: false }

describe('a goto to equatorial coordinates of date', () => {
  it('sets tracking as the way to arrive, writes the coordinates, and finishes when the property goes Busy then Ok', async () => {
    const { goto, sent, answer } = mountWith({ SLEW: true, TRACK: false, SYNC: false })
    const moving = goto.to(target, new AbortController().signal)
    let result: unknown

    void moving.then(value => {
      result = value
    })

    await new Promise(resolve => setTimeout(resolve, 5))

    expect(sent).toEqual([
      { device: 'primary', property: 'ON_COORD_SET', values: { SLEW: false, TRACK: true, SYNC: false } },
      { device: 'primary', property: 'EQUATORIAL_EOD_COORD', values: { RA: 5.5, DEC: 61.25 } },
    ])
    expect(result).toBeUndefined()

    answer('Ok')
    await new Promise(resolve => setTimeout(resolve, 5))

    expect(result).toBeUndefined()

    answer('Busy')
    await new Promise(resolve => setTimeout(resolve, 5))

    expect(result).toBeUndefined()

    answer('Ok')

    expect(await moving).toEqual({ ok: true })
  })

  it('finishes when the mount goes Busy then Idle', async () => {
    const { goto, answer } = mountWith(tracking)
    const moving = goto.to(target, new AbortController().signal)

    await new Promise(resolve => setTimeout(resolve, 5))
    answer('Busy')
    answer('Idle')

    expect(await moving).toEqual({ ok: true })
  })

  it('refuses when the mount has no TRACK element, sending nothing', async () => {
    const { goto, sent } = mountWith({ SLEW: true, SYNC: false })

    expect(await goto.to(target, new AbortController().signal)).toEqual({ ok: false, refusal: 'tracking-mode', reason: 'primary has no TRACK element in ON_COORD_SET' })
    expect(sent).toEqual([])
  })

  it('refuses when the mount does not report ON_COORD_SET at all', async () => {
    const { goto } = mountWith(undefined)

    expect(await goto.to(target, new AbortController().signal)).toMatchObject({ ok: false, refusal: 'tracking-mode' })
  })

  it('stops after a refused tracking mode and never writes the coordinates', async () => {
    const { goto, sent } = mountWith(tracking, new Set(['ON_COORD_SET']))

    expect(await goto.to(target, new AbortController().signal)).toEqual({ ok: false, refusal: 'tracking-mode', reason: 'ON_COORD_SET: no ON_COORD_SET' })
    expect(sent.map(command => command.property)).toEqual(['ON_COORD_SET'])
  })

  it('reports refused coordinates with the mount program words', async () => {
    const { goto } = mountWith(tracking, new Set(['EQUATORIAL_EOD_COORD']))

    expect(await goto.to(target, new AbortController().signal)).toEqual({ ok: false, refusal: 'coordinates', reason: 'no EQUATORIAL_EOD_COORD' })
  })

  it('reports an alert from the mount', async () => {
    const { goto, answer } = mountWith(tracking)
    const moving = goto.to(target, new AbortController().signal)

    await new Promise(resolve => setTimeout(resolve, 5))
    answer('Busy')
    answer('Alert')

    expect(await moving).toEqual({ ok: false, refusal: 'alert', reason: 'the mount answered with an alert' })
  })

  it('stops waiting when the signal aborts', async () => {
    const { goto, answer } = mountWith(tracking)
    const controller = new AbortController()
    const moving = goto.to(target, controller.signal)

    await new Promise(resolve => setTimeout(resolve, 5))
    answer('Busy')
    controller.abort()

    expect(await moving).toMatchObject({ ok: false, refusal: 'aborted' })
  })

  it('does not take another device or property as the answer', async () => {
    const { goto, answer } = mountWith(tracking)
    const moving = goto.to(target, new AbortController().signal)
    let done = false

    void moving.then(() => {
      done = true
    })

    await new Promise(resolve => setTimeout(resolve, 5))
    answer('Busy')
    goto.observe(wire(startedAt + 900, 'set', 'secondary', 'EQUATORIAL_EOD_COORD', { RA: 1, DEC: 1 }, 'Ok'))
    goto.observe(wire(startedAt + 901, 'set', 'primary', 'TELESCOPE_PARK', { PARK: false }, 'Ok'))
    await new Promise(resolve => setTimeout(resolve, 5))

    expect(done).toBe(false)

    answer('Ok')

    expect(await moving).toEqual({ ok: true })
  })
})
