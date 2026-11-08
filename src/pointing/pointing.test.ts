import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { findRow } from '../catalog/search.ts'
import type { Command, Outcome } from '../commands/sender.ts'
import { makePicture } from '../rig/picture.ts'
import { connected, phoenixLongitude, startedAt, wire } from '../testing/entries.ts'
import { makePointing } from './pointing.ts'
import { targetOf } from './target.ts'

const t = (seconds: number) => startedAt + seconds * 1000

function mountRig(options: { parked?: boolean; connected?: boolean; site?: boolean } = {}) {
  const picture = makePicture()
  const define = (property: string, elements: Readonly<Record<string, number | boolean | string>>, state = 'Ok') => picture.apply(wire(t(1), 'def', 'mount', property, elements, state), t(1))

  picture.apply(connected(t(0)), t(0))
  define('CONNECTION', { CONNECT: options.connected ?? true, DISCONNECT: !(options.connected ?? true) })
  define('ON_COORD_SET', { TRACK: false, SLEW: true, SYNC: false })
  define('EQUATORIAL_EOD_COORD', { RA: 6, DEC: 10 }, 'Ok')
  define('TELESCOPE_PARK', { PARK: options.parked ?? false, UNPARK: !(options.parked ?? false) })
  define('TELESCOPE_TRACK_STATE', { TRACK_ON: false, TRACK_OFF: true })
  define('TELESCOPE_HOME', { GO: false })
  define('TELESCOPE_ABORT_MOTION', { ABORT: false })
  define('MERIDIAN_LIMIT', { LIMIT: 5 })

  if (options.site !== false) define('GEOGRAPHIC_COORD', { LAT: 33.45, LONG: phoenixLongitude, ELEV: 331 })

  return picture
}

function setup(options: { outcomes?: ReadonlyArray<Outcome>; picture?: ReturnType<typeof makePicture>; at?: number } = {}) {
  const sent: Command[] = []
  let index = 0
  let clock = options.at ?? t(100)
  const picture = options.picture ?? mountRig()

  const pointing = makePointing({
    picture,
    sender: {
      send: async command => {
        sent.push(command)

        return options.outcomes?.[index++] ?? { result: 'written' }
      },
    },
    settings: { mount: 'mount', searchResults: 10 },
    now: () => clock,
  })

  const slewState = (state: string) => pointing.observe(wire(clock, 'set', 'mount', 'EQUATORIAL_EOD_COORD', { RA: 6, DEC: 10 }, state))

  return { pointing, sent, picture, slewState, advance: (ms: number) => (clock += ms) }
}

const m31 = findRow('ngc0224')!

describe('goto', () => {
  it('sets the coordinate mode to track, then writes the target in coordinates of date', async () => {
    const { pointing, sent } = setup()
    const expected = targetOf(m31, t(100))

    expect(await pointing.act({ action: 'goto', id: 'ngc0224' })).toEqual({ ok: true })
    expect(sent.map(each => [each.device, each.property, each.values])).toEqual([
      ['mount', 'ON_COORD_SET', { TRACK: true, SLEW: false, SYNC: false }],
      ['mount', 'EQUATORIAL_EOD_COORD', { RA: expected.raHours, DEC: expected.decDegrees }],
    ])
    expect(expected.raHours).not.toBeCloseTo(m31[4] / 15, 3)
  })

  it('does not write the coordinates when the coordinate mode was refused, and says so', async () => {
    const { pointing, sent } = setup({ outcomes: [{ result: 'refused', reason: 'ON_COORD_SET is read-only' }] })

    expect(await pointing.act({ action: 'goto', id: 'ngc0224' })).toEqual({ ok: false, reason: 'ON_COORD_SET: ON_COORD_SET is read-only' })
    expect(sent).toHaveLength(1)
    expect(pointing.view().goto).toMatchObject({ phase: 'failed', detail: 'ON_COORD_SET: ON_COORD_SET is read-only' })
  })

  it('reports a goto the rig program never answered as failed with the reason, and never writes it again', async () => {
    const { pointing, sent } = setup({ outcomes: [{ result: 'written' }, { result: 'unknown', reason: 'no answer from the rig program within 10 s' }] })

    expect(await pointing.act({ action: 'goto', id: 'ngc0224' })).toMatchObject({ ok: false })
    expect(sent).toHaveLength(2)
    expect(pointing.view().goto?.phase).toBe('failed')
  })

  it('shows the target, then the slew, then the arrival with the separation', async () => {
    const { pointing, slewState, advance } = setup()

    await pointing.act({ action: 'goto', id: 'ngc0224' })

    expect(pointing.view().goto).toMatchObject({ id: 'ngc0224', name: 'Andromeda Galaxy', phase: 'sent', sentAt: t(100) })

    slewState('Busy')

    expect(pointing.view().goto?.phase).toBe('slewing')

    advance(30_000)
    slewState('Ok')

    expect(pointing.view().goto).toMatchObject({ phase: 'arrived', arrivedAt: t(130) })
    expect(pointing.view().goto?.separationDegrees).toBeGreaterThan(0)
  })

  it('does not take a state from before the goto was sent for its arrival', async () => {
    const { pointing, slewState } = setup()

    slewState('Busy')
    slewState('Ok')
    await pointing.act({ action: 'goto', id: 'ngc0224' })

    expect(pointing.view().goto?.phase).toBe('sent')
  })

  it('shows an alert from the mount as a failed slew', async () => {
    const { pointing, slewState } = setup()

    await pointing.act({ action: 'goto', id: 'ngc0224' })
    slewState('Busy')
    slewState('Alert')

    expect(pointing.view().goto).toMatchObject({ phase: 'failed', detail: 'the mount answered the slew with an alert' })
  })

  it('refuses a parked mount, a disconnected one, and an unknown target', async () => {
    const parked = setup({ picture: mountRig({ parked: true }) })
    const away = setup({ picture: mountRig({ connected: false }) })
    const known = setup()

    expect(await parked.pointing.act({ action: 'goto', id: 'ngc0224' })).toEqual({ ok: false, reason: 'mount is parked: Unpark first' })
    expect(await away.pointing.act({ action: 'goto', id: 'ngc0224' })).toEqual({ ok: false, reason: 'mount is not connected' })
    expect(await known.pointing.act({ action: 'goto', id: 'nope' })).toEqual({ ok: false, reason: 'no catalog target nope' })
    expect([parked, away, known].flatMap(each => each.sent)).toEqual([])
  })
})

describe('stop', () => {
  it('writes the abort while a slew is in progress and marks the goto stopped', async () => {
    const { pointing, sent, slewState } = setup()

    await pointing.act({ action: 'goto', id: 'ngc0224' })
    slewState('Busy')

    expect(pointing.view().goto?.phase).toBe('slewing')
    expect(await pointing.act({ action: 'stop' })).toEqual({ ok: true })
    expect(sent.at(-1)).toEqual({ device: 'mount', property: 'TELESCOPE_ABORT_MOTION', values: { ABORT: true } })
    expect(pointing.view().goto).toMatchObject({ phase: 'stopped', detail: 'Stop pressed, abort written' })

    slewState('Ok')

    expect(pointing.view().goto?.phase).toBe('stopped')
  })

  it('writes while a goto is still being sent, and with no rig picture at all', async () => {
    const empty = setup({ picture: makePicture() })

    expect(await empty.pointing.act({ action: 'stop' })).toEqual({ ok: true })
    expect(empty.sent).toEqual([{ device: 'mount', property: 'TELESCOPE_ABORT_MOTION', values: { ABORT: true } }])
  })

  it('says when the abort was not written', async () => {
    const { pointing } = setup({ outcomes: [{ result: 'unknown', reason: 'no answer from the rig program within 10 s' }] })

    expect(await pointing.act({ action: 'stop' })).toEqual({ ok: false, reason: 'TELESCOPE_ABORT_MOTION: no answer from the rig program within 10 s' })
  })
})

describe('the other mount controls', () => {
  it('unparks, goes home, and turns tracking on and off', async () => {
    const { pointing, sent } = setup()

    await pointing.act({ action: 'unpark' })
    await pointing.act({ action: 'home' })
    await pointing.act({ action: 'tracking', on: true })
    await pointing.act({ action: 'tracking', on: false })

    expect(sent.map(each => [each.property, each.values])).toEqual([
      ['TELESCOPE_PARK', { UNPARK: true }],
      ['TELESCOPE_HOME', { GO: true }],
      ['TELESCOPE_TRACK_STATE', { TRACK_ON: true, TRACK_OFF: false }],
      ['TELESCOPE_TRACK_STATE', { TRACK_ON: false, TRACK_OFF: true }],
    ])
  })

  it('refuses a control the mount has not defined on the stream', async () => {
    const { pointing, sent } = setup({ picture: makePicture() })

    for (const request of [{ action: 'unpark' }, { action: 'home' }, { action: 'tracking', on: true }, { action: 'goto', id: 'ngc0224' }]) expect(await pointing.act(request)).toMatchObject({ ok: false })

    expect(sent).toEqual([])
  })

  it('shows whether the mount is parked and tracking', () => {
    const { pointing } = setup()

    expect(pointing.view()).toMatchObject({ parked: false, tracking: false, goto: undefined })
  })
})

describe('no Park', () => {
  it('has no way to park: the action is refused and no command ever parks', async () => {
    const { pointing, sent } = setup()

    expect(await pointing.act({ action: 'park' })).toMatchObject({ ok: false })
    expect(await pointing.act({ action: 'tracking', on: true, park: true })).toMatchObject({ ok: false })

    await pointing.act({ action: 'unpark' })
    await pointing.act({ action: 'home' })
    await pointing.act({ action: 'goto', id: 'ngc0224' })
    await pointing.act({ action: 'stop' })

    for (const command of sent) {
      expect(command.property).not.toBe('TELESCOPE_PARK_OPTION')
      expect(command.values['PARK']).toBeUndefined()
    }
  })

  it('has no Park button or action on the page or in the code', () => {
    const page = readFileSync(new URL('../page/night.html', import.meta.url), 'utf8')
    const code = readFileSync(new URL('./pointing.ts', import.meta.url), 'utf8')

    expect(page).not.toMatch(/>\s*Park\s*</i)
    expect(page).not.toMatch(/action: 'park'/)
    expect(code).not.toMatch(/\bPARK: true|'park'/)
  })
})

describe('the preview before the goto', () => {
  it('gives the target in both epochs and when it reaches the meridian limit', () => {
    const { pointing } = setup()
    const preview = pointing.preview('ngc0224')

    expect(preview).toMatchObject({ ok: true, target: { id: 'ngc0224', raJ2000Hours: m31[4] / 15 } })
    expect(preview.ok && typeof preview.meridianLimitAt === 'number').toBe(true)
  })

  it('says why there is none', () => {
    expect(setup().pointing.preview('nope')).toEqual({ ok: false, reason: 'no catalog target nope' })
  })

  it('goes without the mount reporting its site, with no meridian limit time', async () => {
    const { pointing, sent } = setup({ picture: mountRig({ site: false }) })
    const preview = pointing.preview('ngc0224')

    expect(preview.ok && preview.meridianLimitAt).toBeUndefined()
    expect(await pointing.act({ action: 'goto', id: 'ngc0224' })).toEqual({ ok: true })
    expect(sent).toHaveLength(2)
  })

  it('lists catalog matches up to the setting', () => {
    expect(setup().pointing.search('m31')[0]?.id).toBe('ngc0224')
    expect(setup().pointing.search('ngc')).toHaveLength(10)
  })
})
