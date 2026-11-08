import { describe, expect, it } from 'vitest'
import type { Command, Outcome } from '../commands/sender.ts'
import { makePicture } from '../rig/picture.ts'
import { connected, startedAt, wire } from '../testing/entries.ts'
import { makePrepare } from './prepare.ts'
import { makePrepareView } from './view.ts'

const settings = { focuser: 'focuser', box: 'box', focuserNudgeSteps: 100 }

function rig(options: { limits?: boolean; position?: number } = {}) {
  const picture = makePicture()
  const at = startedAt + 1
  const position = options.position ?? 21450

  picture.apply(connected(startedAt), at)
  picture.apply(wire(at, 'def', 'focuser', 'ABS_FOCUS_POSITION', { FOCUS_ABSOLUTE_POSITION: position }, 'Ok', 'in', options.limits === false ? {} : { FOCUS_ABSOLUTE_POSITION: { min: 0, max: 60000 } }), at)
  picture.apply(wire(at, 'def', 'focuser', 'REL_FOCUS_POSITION', { FOCUS_RELATIVE_POSITION: 0 }, 'Ok', 'in', options.limits === false ? {} : { FOCUS_RELATIVE_POSITION: { min: 0, max: 300000 } }), at)
  picture.apply(wire(at, 'def', 'focuser', 'FOCUS_MOTION', { FOCUS_INWARD: true, FOCUS_OUTWARD: false }, 'Ok'), at)
  picture.apply(wire(at, 'def', 'box', 'DEW_CHANNELS', { DEW_CHANNEL_1: true, DEW_CHANNEL_2: false }, 'Idle'), at)
  picture.apply(wire(at, 'def', 'box', 'DEW_DUTY_CYCLES', { DEW_CHANNEL_1: 0, DEW_CHANNEL_2: 40 }, 'Idle', 'in', { DEW_CHANNEL_1: { min: 0, max: 100 }, DEW_CHANNEL_2: { min: 0, max: 100 } }), at)
  picture.apply(wire(at, 'def', 'box', 'DEW_LABELS', { DEW_CHANNEL_1: 'Dew A', DEW_CHANNEL_2: 'Dew B' }, 'Idle'), at)
  picture.apply(wire(at, 'def', 'box', 'AUTO_DEW_CONTROL', { DEW_CHANNEL_1: false }, 'Idle'), at)

  return picture
}

function setup(outcomes: ReadonlyArray<Outcome> = [], picture = rig()) {
  const sent: Command[] = []
  let index = 0

  const prepare = makePrepare({
    picture,
    sender: {
      send: async command => {
        sent.push(command)

        return outcomes[index++] ?? { result: 'written' }
      },
    },
    settings,
  })

  return { prepare, sent, picture }
}

describe('focuser', () => {
  it('moves to a position inside the limits the driver gave', async () => {
    const { prepare, sent } = setup()

    expect(await prepare.act({ action: 'focuser-move', position: 30000 })).toEqual({ ok: true })
    expect(sent).toEqual([{ device: 'focuser', property: 'ABS_FOCUS_POSITION', values: { FOCUS_ABSOLUTE_POSITION: 30000 } }])
  })

  it.each([60001, -1])('refuses position %i outside the limits without sending anything', async position => {
    const { prepare, sent } = setup()

    expect(await prepare.act({ action: 'focuser-move', position })).toEqual({ ok: false, reason: `position ${position} is outside the limits the driver gives, 0 to 60000` })
    expect(sent).toEqual([])
  })

  it('accepts the limits themselves', async () => {
    const { prepare, sent } = setup()

    expect(await prepare.act({ action: 'focuser-move', position: 60000 })).toEqual({ ok: true })
    expect(await prepare.act({ action: 'focuser-move', position: 0 })).toEqual({ ok: true })
    expect(sent).toHaveLength(2)
  })

  it('refuses a position that is not a whole number of steps', async () => {
    const { prepare, sent } = setup()

    expect(await prepare.act({ action: 'focuser-move', position: 100.5 })).toMatchObject({ ok: false })
    expect(sent).toEqual([])
  })

  it('leaves the check to the rig program when the stream carries no limits', async () => {
    const { prepare, sent } = setup([], rig({ limits: false }))

    expect(await prepare.act({ action: 'focuser-move', position: 90000 })).toEqual({ ok: true })
    expect(sent).toHaveLength(1)
  })

  it('refuses when the focuser is not on the stream', async () => {
    const { prepare, sent } = setup([], makePicture())

    expect(await prepare.act({ action: 'focuser-move', position: 100 })).toEqual({ ok: false, reason: 'focuser has no ABS_FOCUS_POSITION on the stream' })
    expect(sent).toEqual([])
  })

  it('nudges in by the setting: direction first, then the relative move', async () => {
    const { prepare, sent } = setup()

    expect(await prepare.act({ action: 'focuser-nudge', direction: 'in' })).toEqual({ ok: true })
    expect(sent.map(each => [each.property, each.values])).toEqual([
      ['FOCUS_MOTION', { FOCUS_INWARD: true, FOCUS_OUTWARD: false }],
      ['REL_FOCUS_POSITION', { FOCUS_RELATIVE_POSITION: 100 }],
    ])
  })

  it('nudges out', async () => {
    const { prepare, sent } = setup()

    await prepare.act({ action: 'focuser-nudge', direction: 'out' })

    expect(sent[0]?.values).toEqual({ FOCUS_INWARD: false, FOCUS_OUTWARD: true })
  })

  it('does not move when the direction was refused', async () => {
    const { prepare, sent } = setup([{ result: 'refused', reason: 'FOCUS_MOTION is read-only' }])

    expect(await prepare.act({ action: 'focuser-nudge', direction: 'in' })).toEqual({ ok: false, reason: 'FOCUS_MOTION: FOCUS_MOTION is read-only' })
    expect(sent).toHaveLength(1)
  })

  it('refuses a nudge that would leave the travel', async () => {
    const low = setup([], rig({ position: 50 }))
    const high = setup([], rig({ position: 59950 }))

    expect(await low.prepare.act({ action: 'focuser-nudge', direction: 'in' })).toMatchObject({ ok: false, reason: 'position after the nudge -50 is outside the limits the driver gives, 0 to 60000' })
    expect(await high.prepare.act({ action: 'focuser-nudge', direction: 'out' })).toMatchObject({ ok: false })
    expect(low.sent).toEqual([])
    expect(high.sent).toEqual([])
  })

  it('writes Stop as a stop command, ahead of anything', async () => {
    const { prepare, sent } = setup([], makePicture())

    expect(await prepare.act({ action: 'focuser-stop' })).toEqual({ ok: true })
    expect(sent).toEqual([{ device: 'focuser', property: 'FOCUS_ABORT_MOTION', values: { ABORT: true } }])
  })

  it('reports what the rig program did with the command', async () => {
    const refused = setup([{ result: 'refused', reason: 'stale' }])
    const unknown = setup([{ result: 'unknown', reason: 'no answer from the rig program within 10 s' }])

    expect(await refused.prepare.act({ action: 'focuser-move', position: 1 })).toEqual({ ok: false, reason: 'ABS_FOCUS_POSITION: stale' })
    expect(await unknown.prepare.act({ action: 'focuser-move', position: 1 })).toEqual({ ok: false, reason: 'ABS_FOCUS_POSITION: no answer from the rig program within 10 s' })
  })
})

describe('dew heaters', () => {
  it('switches one output and leaves the other alone', async () => {
    const { prepare, sent } = setup()

    expect(await prepare.act({ action: 'dew-channel', channel: 'DEW_CHANNEL_2', on: true })).toEqual({ ok: true })
    expect(sent).toEqual([{ device: 'box', property: 'DEW_CHANNELS', values: { DEW_CHANNEL_2: true } }])
  })

  it('sets a duty within the limits and refuses one outside', async () => {
    const { prepare, sent } = setup()

    expect(await prepare.act({ action: 'dew-duty', channel: 'DEW_CHANNEL_1', percent: 60 })).toEqual({ ok: true })
    expect(await prepare.act({ action: 'dew-duty', channel: 'DEW_CHANNEL_1', percent: 101 })).toEqual({ ok: false, reason: 'duty 101 is outside the limits the driver gives, 0 to 100' })
    expect(sent.map(each => each.values)).toEqual([{ DEW_CHANNEL_1: 60 }])
  })

  it('sets automatic dew on every element of its property', async () => {
    const { prepare, sent } = setup()

    expect(await prepare.act({ action: 'dew-auto', on: true })).toEqual({ ok: true })
    expect(sent).toEqual([{ device: 'box', property: 'AUTO_DEW_CONTROL', values: { DEW_CHANNEL_1: true } }])
  })

  it('refuses an output the box does not have', async () => {
    const { prepare, sent } = setup()

    expect(await prepare.act({ action: 'dew-channel', channel: 'DEW_CHANNEL_9', on: true })).toEqual({ ok: false, reason: 'box has no dew output DEW_CHANNEL_9' })
    expect(await prepare.act({ action: 'dew-duty', channel: 'DEW_CHANNEL_9', percent: 10 })).toMatchObject({ ok: false })
    expect(sent).toEqual([])
  })

  it('refuses when the box has not reported its dew properties', async () => {
    const { prepare, sent } = setup([], makePicture())

    expect(await prepare.act({ action: 'dew-auto', on: true })).toMatchObject({ ok: false })
    expect(await prepare.act({ action: 'dew-channel', channel: 'DEW_CHANNEL_1', on: true })).toMatchObject({ ok: false })
    expect(sent).toEqual([])
  })
})

describe('requests', () => {
  it.each([null, 'move', { action: 'park' }, { action: 'focuser-move' }, { action: 'focuser-move', position: '5' }, { action: 'focuser-stop', extra: 1 }, { action: 'dew-duty', channel: 'DEW_CHANNEL_1' }])('refuses %j', async request => {
    const { prepare, sent } = setup()

    expect(await prepare.act(request)).toMatchObject({ ok: false })
    expect(sent).toEqual([])
  })
})

describe('the view', () => {
  it('gives the page the focuser limits, the outputs and automatic dew', () => {
    const view = makePrepareView(rig(), settings)

    expect(view.focuser).toEqual({ known: true, position: 21450, min: 0, max: 60000, moving: false, nudgeSteps: 100 })
    expect(view.dew).toEqual({
      channels: [
        { id: 'DEW_CHANNEL_1', label: 'Dew A', on: true, duty: 0, min: 0, max: 100 },
        { id: 'DEW_CHANNEL_2', label: 'Dew B', on: false, duty: 40, min: 0, max: 100 },
      ],
      auto: false,
    })
  })

  it('says the focuser is moving while its position is Busy', () => {
    const picture = rig()

    picture.apply(wire(startedAt + 2, 'set', 'focuser', 'ABS_FOCUS_POSITION', { FOCUS_ABSOLUTE_POSITION: 21500 }, 'Busy'), startedAt + 2)

    expect(makePrepareView(picture, settings).focuser).toMatchObject({ position: 21500, moving: true, min: 0, max: 60000 })
  })

  it('knows nothing about a box that has not reported', () => {
    expect(makePrepareView(makePicture(), settings)).toEqual({
      focuser: { known: false, position: undefined, min: undefined, max: undefined, moving: false, nudgeSteps: 100 },
      dew: { channels: [], auto: undefined },
    })
  })
})
