import { describe, expect, it } from 'vitest'
import { fakeCamera } from '../testing/camera.ts'
import { startedAt, wire } from '../testing/entries.ts'
import { makeAlign } from './run.ts'

const phoenix = { LAT: 33.45, LONG: 247.93, ELEV: 331 }
const solves = [
  { raDegrees: 300, decDegrees: 79.5 },
  { raDegrees: 245, decDegrees: 80.2 },
  { raDegrees: 190, decDegrees: 80.6 },
  { raDegrees: 190.01, decDegrees: 80.6 },
  { raDegrees: 190.02, decDegrees: 80.6 },
]

describe('a polar alignment run on a scripted camera and mount', () => {
  it('slews to three hour angles, solves a frame at each, then gives a reading for every adjusting frame', async () => {
    const published: Array<{ kind: string; body: Record<string, unknown> }> = []
    const holder = { align: undefined as ReturnType<typeof makeAlign> | undefined }
    let at = startedAt + 1000
    const feed = (kind: string, body: Record<string, unknown>) => holder.align?.observe({ id: `${kind}:${(at += 1)}`, kind, at, run: undefined, body })
    const camera = fakeCamera({
      onEvent: event => {
        if (event.kind === 'exposed') void holder.align?.kept({ file: String(event.body['file']), night: '2026-11-08', bytes: 0, sha256: '' })
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
              setTimeout(() => holder.align?.observe(wire((at += 1), 'set', 'primary', 'EQUATORIAL_EOD_COORD', command.values, 'Ok')), 5)
            }, 5)
          }

          return outcome
        },
      },
      capture: camera.capture,
      solve: async frame => ({ ok: true, ...solves[(camera.capture.labelOf(frame.file)?.frame ?? 1) - 1]! }),
      cards: async frame => [{ key: 'DATE-OBS', value: new Date(startedAt + 60_000 * (camera.capture.labelOf(frame.file)?.frame ?? 1)).toISOString().slice(0, 23), comment: '' }, { key: 'EXPTIME', value: '2', comment: '' }],
      publish: (kind, body) => {
        published.push({ kind, body: { ...body } })
        feed(`vela.align.${kind}`, body)
      },
      settings: { mount: 'primary', camera: 'primary', declinationDegrees: 80, hourAnglesDegrees: [-130, -73, -16], adjustFrames: 2 },
      now: () => startedAt,
    })

    holder.align = align

    expect(align.start({ exposureSeconds: 0.01 })).toEqual({ ok: true })

    await new Promise<void>(resolve => {
      const check = setInterval(() => {
        if (align.view().ended !== undefined && published.filter(entry => entry.kind === 'solve').length === 5) {
          clearInterval(check)
          resolve()
        }
      }, 5)
    })

    expect(slews).toHaveLength(3)
    expect(slews.map(values => (values as { DEC: number }).DEC)).toEqual([80, 80, 80])
    expect(published.map(entry => entry.kind)).toEqual(['started', 'solve', 'solve', 'solve', 'solve', 'solve'])
    expect(published[1]?.body).not.toHaveProperty('altitudeArcmin')
    expect(published[3]?.body).toHaveProperty('altitudeArcmin')
    expect(align.view()).toMatchObject({ ended: 'done', frames: [{ frame: 1, solved: true }, { frame: 2, solved: true }, { frame: 3, solved: true }, { frame: 4, solved: true }, { frame: 5, solved: true }], error: { frame: 5 } })
    expect(align.view().first?.totalArcmin).toBeGreaterThan(0)
  })
})
