import { StreamPosition } from '../../state/entry.ts'
import { describe, expect, it } from 'vitest'
import { fakeCamera } from '../testing/camera.ts'
import { startedAt, wire } from '../testing/entries.ts'
import { makeAlign } from './run.ts'

type Solution = { readonly ok: true; readonly raDegrees: number; readonly decDegrees: number } | { readonly ok: false; readonly reason: string }

const phoenix = { LAT: 33.45, LONG: 247.93, ELEV: 331 }
const solves = [
  { raDegrees: 300, decDegrees: 79.5 },
  { raDegrees: 245, decDegrees: 80.2 },
  { raDegrees: 190, decDegrees: 80.6 },
  { raDegrees: 190.01, decDegrees: 80.6 },
  { raDegrees: 190.02, decDegrees: 80.6 },
]

function scriptedRun(solveFrame: (frame: number) => Solution, solveMs = 0, stopAfter = 5, slewAlertAt = 0, missFrame = 0) {
  const published: Array<{ kind: string; body: Record<string, unknown> }> = []
  const events: string[] = []
  const holder = { align: undefined as ReturnType<typeof makeAlign> | undefined }
  let at = startedAt + 1000
  const feed = (kind: string, body: Record<string, unknown>) => holder.align?.observe({ seq: StreamPosition.make((at += 1)), kind, at, body })
  const camera = fakeCamera({
    onEvent: event => {
      if (event.kind === 'exposed') {
        const file = String(event.body['file'])
        const frame = Number(event.body['frame'])

        setTimeout(() => {
          if (frame === missFrame) return holder.align?.measured({ file, result: 'refused', reason: 'measure is not set up in the rig file' })

          const solution = solveFrame(frame)
          const header = { 'DATE-OBS': new Date(startedAt + 60_000 * frame).toISOString().slice(0, 23), EXPTIME: 2 }

          holder.align?.measured({ file, result: 'measured', solve: solution.ok ? { solved: true, raDegrees: solution.raDegrees, decDegrees: solution.decDegrees, rotationDegrees: undefined } : { solved: false, reason: solution.reason }, stars: undefined, header })
        }, solveMs)
      }
      events.push(`${event.kind}:${String(event.body['frame'] ?? '')}`)
      feed(`vela.run.${event.kind}`, { run: event.run, ...event.body })
    },
  })
  const slews: unknown[] = []

  camera.feed(wire((at += 1), 'def', 'primary', 'GEOGRAPHIC_COORD', phoenix, 'Ok'))
  camera.feed(wire((at += 1), 'def', 'primary', 'ON_COORD_SET', { SLEW: false, TRACK: true, SYNC: false }, 'Ok'))
  camera.feed(wire((at += 1), 'def', 'primary', 'EQUATORIAL_EOD_COORD', { RA: 0, DEC: 90 }, 'Ok'))

  const align = makeAlign({
    picture: camera.picture,
    sender: {
      send: async command => {
        const outcome = await camera.sender.send(command)

        if (command.property === 'EQUATORIAL_EOD_COORD') {
          slews.push(command.values)
          setTimeout(() => {
            holder.align?.observe(wire((at += 1), 'set', 'primary', 'EQUATORIAL_EOD_COORD', command.values, 'Busy'))
            setTimeout(() => holder.align?.observe(wire((at += 1), 'set', 'primary', 'EQUATORIAL_EOD_COORD', command.values, slews.length === slewAlertAt ? 'Alert' : 'Ok')), 5)
          }, 5)
        }

        return outcome
      },
    },
    capture: camera.capture,
    publish: (kind, body) => {
      published.push({ kind, body: { ...body } })
      if (kind === 'solve') events.push(`solve:${String(body['frame'])}`)
      feed(`vela.align.${kind}`, body)
      if (kind === 'solve' && body['frame'] === stopAfter) void camera.capture.stop()
    },
    settings: { mount: 'primary', camera: 'primary', declinationDegrees: 80, hourAnglesDegrees: [-130, -73, -16] },
    now: () => startedAt,
  })

  holder.align = align

  return { align, published, slews, events, camera }
}

function settled(align: ReturnType<typeof makeAlign>, published: ReadonlyArray<{ kind: string }>, solveCount: number) {
  return new Promise<void>(resolve => {
    const check = setInterval(() => {
      if (align.view().ended !== undefined && published.filter(entry => entry.kind === 'solve').length === solveCount) {
        clearInterval(check)
        resolve()
      }
    }, 5)
  })
}

describe('a polar alignment run on a scripted camera and mount', () => {
  it('slews to three hour angles, solves a frame at each, then gives a reading for every adjusting frame until Stop', async () => {
    const { align, published, slews } = scriptedRun(frame => ({ ok: true, ...solves[frame - 1]! }))

    expect(align.start({ exposureSeconds: 0.01 })).toEqual({ ok: true })

    await settled(align, published, 5)

    expect(slews).toHaveLength(3)
    expect(slews.map(values => (values as { DEC: number }).DEC)).toEqual([80, 80, 80])
    expect(published.map(entry => entry.kind)).toEqual(['started', 'solve', 'solve', 'solve', 'solve', 'solve'])
    expect(published[1]?.body).not.toHaveProperty('altitudeArcmin')
    expect(published[3]?.body).toHaveProperty('altitudeArcmin')
    expect(align.view()).toMatchObject({ ended: 'stopped', frames: [{ frame: 1, solved: true }, { frame: 2, solved: true }, { frame: 3, solved: true }, { frame: 4, solved: true }, { frame: 5, solved: true }], error: { frame: 5 }, previous: { frame: 4 } })
    expect(align.view().first?.totalArcmin).toBeGreaterThan(0)
    expect(align.view().lastFrameAt).toBeGreaterThan(startedAt)
  })

  it('stops before the next slew when a frame does not solve', async () => {
    const { align, published, slews } = scriptedRun(frame => (frame === 1 ? { ok: false, reason: 'Not enough stars.' } : { ok: true, ...solves[frame - 1]! }))

    expect(align.start({ exposureSeconds: 0.01 })).toEqual({ ok: true })

    await settled(align, published, 1)

    expect(slews).toHaveLength(1)
    expect(align.view()).toMatchObject({ ended: 'refused', frames: [{ frame: 1, solved: false, reason: 'Not enough stars.' }] })
  })

  it('keeps taking adjusting frames when one does not solve while the knobs turn', async () => {
    const { align, published, slews } = scriptedRun(frame => (frame === 4 ? { ok: false, reason: 'Not enough stars.' } : { ok: true, ...solves[frame - 1]! }))

    expect(align.start({ exposureSeconds: 0.01 })).toEqual({ ok: true })

    await settled(align, published, 5)

    expect(slews).toHaveLength(3)
    expect(align.view()).toMatchObject({ ended: 'stopped', frames: [{ solved: true }, { solved: true }, { solved: true }, { frame: 4, solved: false }, { frame: 5, solved: true }], error: { frame: 5 }, previous: { frame: 3 } })
  })

  it('moves on to the next adjusting frame when the rig program did not measure one', async () => {
    const { align, published } = scriptedRun(frame => ({ ok: true, ...solves[frame - 1]! }), 0, 5, 0, 4)

    expect(align.start({ exposureSeconds: 0.01 })).toEqual({ ok: true })

    await settled(align, published, 5)

    expect(align.view()).toMatchObject({ ended: 'stopped', frames: [{ solved: true }, { solved: true }, { solved: true }, { frame: 4, solved: false, reason: 'the rig program did not measure it: measure is not set up in the rig file' }, { frame: 5, solved: true }], error: { frame: 5 } })
  })

  it('stops like a failed solve when one of the first three frames was not measured', async () => {
    const { align, published, slews } = scriptedRun(frame => ({ ok: true, ...solves[frame - 1]! }), 0, 5, 0, 2)

    expect(align.start({ exposureSeconds: 0.01 })).toEqual({ ok: true })

    await settled(align, published, 2)

    expect(slews).toHaveLength(2)
    expect(align.view()).toMatchObject({ ended: 'refused', frames: [{ frame: 1, solved: true }, { frame: 2, solved: false }] })
  })

  it('takes each adjusting frame only after the last one is solved, so the readings never fall behind', async () => {
    const { align, published, events } = scriptedRun(frame => ({ ok: true, ...solves[frame - 1]! }), 30)

    expect(align.start({ exposureSeconds: 0.01 })).toEqual({ ok: true })

    await settled(align, published, 5)

    for (const frame of [1, 2, 3, 4]) expect(events.indexOf(`solve:${frame}`)).toBeLessThan(events.indexOf(`exposed:${frame + 1}`))
  })

  it('waits with the reason on the page when the mount answers a slew with an alert, and Stop ends it', async () => {
    const { align, slews, camera } = scriptedRun(frame => ({ ok: true, ...solves[frame - 1]! }), 0, 5, 2)

    expect(align.start({ exposureSeconds: 0.01 })).toEqual({ ok: true })

    while (align.view().problem === undefined) await new Promise(resolve => setTimeout(resolve, 2))

    expect(align.view().problem).toBe('the mount answered the slew to hour angle -73° with an alert')
    expect(slews).toHaveLength(2)

    await camera.capture.stop()

    while (align.view().ended === undefined) await new Promise(resolve => setTimeout(resolve, 2))

    expect(align.view().ended).toBe('stopped')
    expect(slews).toHaveLength(2)
  })
})

describe('a polar alignment run whose first slew the mount program refuses', () => {
  function refusedRun(mountProperties: Record<string, Record<string, boolean | number>>, refusing: string | undefined) {
    const camera = fakeCamera()
    let at = startedAt + 1000

    camera.feed(wire((at += 1), 'def', 'primary', 'GEOGRAPHIC_COORD', phoenix, 'Ok'))

    for (const [property, values] of Object.entries(mountProperties)) camera.feed(wire((at += 1), 'def', 'primary', property, values, 'Ok'))

    const align = makeAlign({
      picture: camera.picture,
      sender: { send: async command => (command.property === refusing ? { result: 'refused', reason: 'the mount program said no' } : camera.sender.send(command)) },
      capture: camera.capture,
      publish: () => undefined,
      settings: { mount: 'primary', camera: 'primary', declinationDegrees: 80, hourAnglesDegrees: [-130, -73, -16] },
      now: () => startedAt,
    })

    return { align, camera }
  }

  async function problemOf(run: ReturnType<typeof refusedRun>) {
    expect(run.align.start({ exposureSeconds: 0.01 })).toEqual({ ok: true })

    while (run.align.view().problem === undefined) await new Promise(resolve => setTimeout(resolve, 2))

    await run.camera.capture.stop()

    return run.align.view().problem
  }

  const onCoordSet = { SLEW: false, TRACK: true, SYNC: false }

  it('says the coordinates were refused, with the hour angle', async () => {
    expect(await problemOf(refusedRun({ ON_COORD_SET: onCoordSet, EQUATORIAL_EOD_COORD: { RA: 0, DEC: 90 } }, 'EQUATORIAL_EOD_COORD'))).toBe('slew to hour angle -130°: the mount program said no')
  })

  it('says the tracking mode was refused', async () => {
    expect(await problemOf(refusedRun({ ON_COORD_SET: onCoordSet }, 'ON_COORD_SET'))).toBe('ON_COORD_SET: the mount program said no')
  })

  it('says the mount has no TRACK element', async () => {
    expect(await problemOf(refusedRun({ ON_COORD_SET: { SLEW: true, SYNC: false } }, undefined))).toBe('primary has no TRACK element in ON_COORD_SET')
  })
})
