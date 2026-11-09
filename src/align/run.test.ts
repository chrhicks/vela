import { describe, expect, it } from 'vitest'
import { fakeCamera } from '../testing/camera.ts'
import { startedAt, wire } from '../testing/entries.ts'
import type { Solution } from '../measure/astap.ts'
import { makeAlign } from './run.ts'

const phoenix = { LAT: 33.45, LONG: 247.93, ELEV: 331 }
const solves = [
  { raDegrees: 300, decDegrees: 79.5 },
  { raDegrees: 245, decDegrees: 80.2 },
  { raDegrees: 190, decDegrees: 80.6 },
  { raDegrees: 190.01, decDegrees: 80.6 },
  { raDegrees: 190.02, decDegrees: 80.6 },
]

function scriptedRun(solveFrame: (frame: number) => Solution, solveMs = 0, stopAfter = 5, slewAlertAt = 0) {
  const published: Array<{ kind: string; body: Record<string, unknown> }> = []
  const events: string[] = []
  const holder = { align: undefined as ReturnType<typeof makeAlign> | undefined }
  let at = startedAt + 1000
  const feed = (kind: string, body: Record<string, unknown>) => holder.align?.observe({ id: `${kind}:${(at += 1)}`, kind, at, run: undefined, body })
  const camera = fakeCamera({
    onEvent: event => {
      if (event.kind === 'exposed') void holder.align?.kept({ file: String(event.body['file']), night: '2026-11-08', bytes: 0, sha256: '' })
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
    solve: async frame => {
      await new Promise(resolve => setTimeout(resolve, solveMs))
      return solveFrame(camera.capture.labelOf(frame.file)?.frame ?? 1)
    },
    cards: async frame => [{ key: 'DATE-OBS', value: new Date(startedAt + 60_000 * (camera.capture.labelOf(frame.file)?.frame ?? 1)).toISOString().slice(0, 23), comment: '' }, { key: 'EXPTIME', value: '2', comment: '' }],
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
    expect(align.view()).toMatchObject({ ended: 'stopped', frames: [{ frame: 1, solved: true }, { frame: 2, solved: true }, { frame: 3, solved: true }, { frame: 4, solved: true }, { frame: 5, solved: true }], error: { frame: 5 } })
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
    expect(align.view()).toMatchObject({ ended: 'stopped', frames: [{ solved: true }, { solved: true }, { solved: true }, { frame: 4, solved: false }, { frame: 5, solved: true }], error: { frame: 5 } })
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
