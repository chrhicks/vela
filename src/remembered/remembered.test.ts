import { describe, expect, it } from 'vitest'
import { entry } from '../../state/testing.ts'
import { coolerFor, lastCentreNear, nothingRemembered, recentLightTargets, remember, shortlistOf } from './remembered.ts'

const fold = (entries: ReadonlyArray<ReturnType<typeof entry>>) => entries.reduce(remember, nothingRemembered)

const light = (at: number, run: string, exposureSeconds: number, count?: number) => entry('vela.run.started', at, { run, object: 'NGC 7635', frameType: 'light', exposureSeconds, ...(count === undefined ? {} : { count }) })
const pass = (at: number, run: string, raDegrees: number, decDegrees: number, rotationDegrees?: number) =>
  entry('vela.centre.pass', at, { run, frame: 1, solved: true, raDegrees, decDegrees, ...(rotationDegrees === undefined ? {} : { rotationDegrees }) })
const lightOn = (at: number, run: string, id: string) =>
  entry('vela.run.started', at, { run, object: id, frameType: 'light', exposureSeconds: 60, target: { id, name: id, raDegrees: 83.82, decDegrees: -5.39 } })
const sent = (at: number, property: string, elements: Readonly<Record<string, number | boolean>>, device = 'primary') => entry('wire', at, { dir: 'out', device, type: 'new', property, elements })
const setpoint = (at: number, celsius: number) => sent(at, 'CCD_TEMPERATURE', { CCD_TEMPERATURE_VALUE: celsius })
const coolerSwitched = (at: number, on: boolean) => sent(at, 'CCD_COOLER', { COOLER_ON: on, COOLER_OFF: !on })
const sensorReads = (at: number, celsius: number) => entry('wire', at, { dir: 'in', device: 'primary', type: 'set', property: 'CCD_TEMPERATURE', state: 'Busy', elements: { CCD_TEMPERATURE_VALUE: celsius } })
const ended = (at: number, run: string, reason: string) => entry('vela.run.ended', at, { run, reason })

describe('what Vela remembers from the stream', () => {
  it('keeps the exposure and count of the last light run on a target, whatever order the entries come in', () => {
    const inOrder = fold([light(100, 'a', 60, 300), light(200, 'b', 120)])
    const replayed = fold([light(200, 'b', 120), light(100, 'a', 60, 300)])

    expect(inOrder.lastLight).toEqual({ exposureSeconds: 120, frames: undefined, at: 200 })
    expect(replayed.lastLight).toEqual(inOrder.lastLight)
  })

  it('does not count a centring, focus or calibration run as the last light run', () => {
    const state = fold([
      light(100, 'a', 60, 300),
      entry('vela.run.started', 200, { run: 'c', object: 'centre', frameType: 'light', exposureSeconds: 2 }),
      entry('vela.run.started', 300, { run: 'd', object: 'dark', frameType: 'dark', exposureSeconds: 120, count: 30 }),
    ])

    expect(state.lastLight).toMatchObject({ exposureSeconds: 60, frames: 300 })
  })

  it('keeps the camera angle of the latest solve that gave one', () => {
    const state = fold([pass(100, 'c1', 350, 61, 109.3), pass(200, 'c2', 83, -5, 109.4), pass(300, 'c3', 83, -5)])

    expect(state.cameraAngle).toEqual({ degrees: 109.4, at: 200 })
  })

  it("takes the camera angle from the rig's solve of a centring frame, and not from an alignment frame near the pole", () => {
    const solved = (at: number, object: string, angle: number) => entry('client.measure', at, { by: 'vela', file: 'a.fits', result: 'measured', solve: { solved: true, raDegrees: 83.8, decDegrees: -5.4, wcs: { CROTA2: angle } }, header: { OBJECT: object } })
    const state = fold([solved(100, 'centre', 109.34), solved(200, 'polar-align', -69.3), entry('client.measure', 300, { by: 'vela', file: 'b.fits', result: 'measured', solve: { solved: false, reason: 'Not enough stars.' }, header: { OBJECT: 'centre' } })])

    expect(state.cameraAngle).toEqual({ degrees: 109.34, at: 100 })
  })

  it('finds the last centre reached near a position, and not one from a centring that was stopped', () => {
    const state = fold([
      pass(100, 'c1', 349.2, 61.0),
      pass(110, 'c1', 349.735, 61.561),
      ended(111, 'c1', 'done'),
      pass(500, 'c2', 349.9, 61.3),
      ended(501, 'c2', 'stopped'),
      pass(600, 'c3', 83.8, -5.4),
      ended(601, 'c3', 'done'),
    ])
    const bubble = { raDegrees: 350.2, decDegrees: 61.2 }

    expect(lastCentreNear(state, bubble, 1.1)).toMatchObject({ run: 'c1', raDegrees: 349.735, decDegrees: 61.561, at: 110 })
    expect(lastCentreNear(state, { raDegrees: 10.7, decDegrees: 41.3 }, 1.1)).toBeUndefined()
  })

  it('keeps the setpoint each light run on a target started with, and the latest of any target, but not a run started with the cooler off', () => {
    const state = fold([
      setpoint(100, -10),
      coolerSwitched(101, true),
      lightOn(200, 'a', 'orion'),
      coolerSwitched(300, false),
      lightOn(400, 'b', 'rosette'),
    ])

    expect(state.targetCoolers).toEqual([
      { target: 'orion', setting: { state: 'on', celsius: -10 }, at: 200 },
    ])
    expect(state.lastCooler).toEqual({ setting: { state: 'on', celsius: -10 }, at: 200 })
  })

  it('offers a target its own cooler, and the latest of any target when it has none', () => {
    const state = fold([setpoint(100, -10), coolerSwitched(101, true), lightOn(200, 'a', 'orion'), setpoint(300, -5), lightOn(400, 'b', 'rosette')])

    expect(coolerFor(state, 'orion')).toEqual({ setting: { state: 'on', celsius: -10 }, at: 200 })
    expect(coolerFor(state, 'rosette')).toEqual({ setting: { state: 'on', celsius: -5 }, at: 400 })
    expect(coolerFor(state, 'bubble')).toEqual({ setting: { state: 'on', celsius: -5 }, at: 400 })
    expect(coolerFor(nothingRemembered, 'orion')).toBeUndefined()
  })

  it('rounds the reported sensor temperature when the cooler is on and no setpoint was recorded', () => {
    const state = fold([coolerSwitched(100, true), sensorReads(110, 14.2), sensorReads(120, -9.7), lightOn(200, 'a', 'orion')])

    expect(state.lastCooler).toEqual({ setting: { state: 'on', celsius: -10 }, at: 200 })
  })

  it('remembers no cooler for a run that starts before the camera was seen written, or for a run that is not a light run on a target', () => {
    const state = fold([
      lightOn(50, 'a', 'orion'),
      setpoint(100, -10),
      coolerSwitched(101, true),
      entry('vela.run.started', 200, { run: 'c', object: 'dark', frameType: 'dark', exposureSeconds: 120, count: 30 }),
      entry('vela.run.started', 300, { run: 'd', object: 'centre', frameType: 'light', exposureSeconds: 2 }),
    ])

    expect(state.targetCoolers).toEqual([])
    expect(state.lastCooler).toBeUndefined()
  })

  it("ignores another device's cooler and what the camera reports about its cooler", () => {
    const state = fold([
      setpoint(100, -10),
      coolerSwitched(101, true),
      sent(150, 'CCD_COOLER', { COOLER_ON: false, COOLER_OFF: true }, 'guide'),
      entry('wire', 160, { dir: 'in', device: 'primary', type: 'set', property: 'CCD_COOLER', state: 'Ok', elements: { COOLER_ON: false, COOLER_OFF: true } }),
      lightOn(200, 'a', 'orion'),
    ])

    expect(state.lastCooler).toEqual({ setting: { state: 'on', celsius: -10 }, at: 200 })
  })

  it('does not give an earlier run the cooler of a later write when the stream is replayed over what is already known', () => {
    const night = [setpoint(100, -10), coolerSwitched(101, true), lightOn(200, 'a', 'orion'), coolerSwitched(300, false)]
    const state = fold([...night, ...night])

    expect(state.targetCoolers).toEqual([{ target: 'orion', setting: { state: 'on', celsius: -10 }, at: 200 }])
    expect(state.camera).toMatchObject({ on: false, setpoint: -10, wrote: 300 })
  })

  describe('the shortlist', () => {
    const exposed = (at: number, run: string) => entry('vela.run.exposed', at, { run, frame: 1 })
    const imaged = (at: number, run: string, id: string) => [lightOn(at, run, id), exposed(at + 10, run)]
    const edit = (at: number, target: string, action: 'add' | 'remove', from?: ReadonlyArray<string>) => entry('vela.shortlist', at, { target, action, ...(from === undefined ? {} : { from }) })

    it('is the most recently imaged targets, newest first, one entry each, until the first edit', () => {
      const state = fold([...imaged(100, 'a', 'orion'), ...imaged(200, 'b', 'triangulum'), ...imaged(300, 'c', 'orion'), ...imaged(400, 'd', 'pinwheel')])

      expect(state.shortlist).toBeUndefined()
      expect(shortlistOf(state, 5)).toEqual(['pinwheel', 'orion', 'triangulum'])
      expect(shortlistOf(state, 2)).toEqual(['pinwheel', 'orion'])
      expect(shortlistOf(state, 0)).toEqual([])
    })

    it('leaves out a light run that kept no frame, and what is not a light run on a catalogued target', () => {
      const state = fold([
        ...imaged(100, 'a', 'orion'),
        lightOn(200, 'b', 'triangulum'),
        entry('vela.run.started', 300, { run: 'c', object: 'dark', frameType: 'dark', exposureSeconds: 120, count: 30 }),
        entry('vela.run.started', 400, { run: 'd', object: 'centre', frameType: 'light', exposureSeconds: 2 }),
        exposed(410, 'd'),
        exposed(420, 'b'),
      ])

      expect(shortlistOf(state, 5)).toEqual(['orion'])
      expect(fold([lightOn(200, 'b', 'triangulum')]).lightTargets).toEqual([])
    })

    it('is seeded from the targets that earlier history only knows by their cooler, after the ones it knows as imaged', () => {
      const state = fold([
        setpoint(50, -10),
        coolerSwitched(51, true),
        lightOn(100, 'old', 'soul'),
        lightOn(150, 'older', 'pinwheel'),
        ...imaged(200, 'new', 'orion'),
      ])

      expect(state.targetCoolers.map(known => known.target).sort()).toEqual(['orion', 'pinwheel', 'soul'])
      expect(recentLightTargets(state, 5)).toEqual(['orion', 'pinwheel', 'soul'])
      expect(recentLightTargets({ ...nothingRemembered, targetCoolers: [{ target: 'soul', setting: { state: 'on', celsius: -10 }, at: 100 }] }, 5)).toEqual(['soul'])
    })

    it('starts the first edit from the list that was shown, and keeps it after that', () => {
      const shown = ['pinwheel', 'orion']
      const state = fold([...imaged(100, 'a', 'orion'), edit(500, 'triangulum', 'add', shown), ...imaged(600, 'b', 'soul')])

      expect(state.shortlist).toEqual(['pinwheel', 'orion', 'triangulum'])
      expect(shortlistOf(state, 5)).toEqual(['pinwheel', 'orion', 'triangulum'])
    })

    it('is empty, and stays empty, once its last target is removed, which is not the same as never edited', () => {
      const emptied = fold([...imaged(100, 'a', 'orion'), edit(500, 'orion', 'remove', ['orion']), ...imaged(600, 'b', 'soul')])
      const never = fold([...imaged(100, 'a', 'orion'), ...imaged(600, 'b', 'soul')])

      expect(emptied.shortlist).toEqual([])
      expect(shortlistOf(emptied, 5)).toEqual([])
      expect(never.shortlist).toBeUndefined()
      expect(shortlistOf(never, 5)).toEqual(['soul', 'orion'])
    })

    it('does not add a target twice or remove one that is not there, and keeps the order it was added in', () => {
      const state = fold([edit(100, 'orion', 'add', []), edit(110, 'triangulum', 'add'), edit(120, 'orion', 'add'), edit(130, 'soul', 'remove'), edit(140, 'pinwheel', 'add'), edit(150, 'triangulum', 'remove')])

      expect(state.shortlist).toEqual(['orion', 'pinwheel'])
    })

    it('comes out the same when the stream is replayed over what is already kept', () => {
      const night = [edit(100, 'orion', 'add', ['soul']), edit(110, 'triangulum', 'add'), edit(120, 'soul', 'remove'), edit(130, 'pinwheel', 'add')]
      const once = fold(night)

      expect(once.shortlist).toEqual(['orion', 'triangulum', 'pinwheel'])
      expect(night.reduce(remember, once).shortlist).toEqual(once.shortlist)
    })

    it('does not start from the list shown when it is already edited', () => {
      const state = fold([edit(100, 'orion', 'add', []), edit(200, 'soul', 'add', ['pinwheel'])])

      expect(state.shortlist).toEqual(['orion', 'soul'])
    })
  })
})
