import { describe, expect, it } from 'vitest'
import { fromMount } from '../sky/coordinates.ts'
import { StreamPosition, type Entry } from '../../state/entry.ts'
import { fakeCamera } from '../testing/camera.ts'
import { phoenixLongitude, startedAt, wire } from '../testing/entries.ts'
import { makeCentre } from './centre.ts'
import { makePointing } from './pointing.ts'

type Values = Readonly<Record<string, number | boolean | string>>

function scriptedMount(options: { errorDegrees: number; unsolved?: ReadonlyArray<number>; refuseSync?: string; toleranceArcmin?: number }) {
  const published: Array<{ kind: string; body: Record<string, unknown> }> = []
  const holder = { centre: undefined as ReturnType<typeof makeCentre> | undefined }
  const sent: Array<{ property: string; values: Values }> = []
  let at = startedAt + 1000
  let mode = 'TRACK'
  let errorDegrees = options.errorDegrees
  let pointed = { raDegrees: 0, decDegrees: 90 }

  const feedAll = (entry: Entry) => {
    camera.feed(entry)
    pointing.observe(entry)
    holder.centre?.observe(entry)
  }

  const camera = fakeCamera({
    onEvent: event => {
      if (event.kind === 'exposed') {
        const file = String(event.body['file'])
        const frame = Number(event.body['frame'])
        const sky = fromMount({ raDegrees: pointed.raDegrees, decDegrees: pointed.decDegrees + errorDegrees }, new Date(startedAt))

        setTimeout(() => {
          const solve = options.unsolved?.includes(frame) ? { solved: false as const, reason: 'Not enough stars.' } : { solved: true as const, ...sky }

          holder.centre?.measured({ file, result: 'measured', solve, stars: undefined, header: { 'DATE-OBS': new Date(startedAt).toISOString().slice(0, 23), EXPTIME: 0 } })
        }, 2)
      }
      feedAll({ seq: StreamPosition.make(0), kind: `vela.run.${event.kind}`, at, body: { run: event.run, ...event.body } })
    },
  })

  camera.script.ignore.add('EQUATORIAL_EOD_COORD')

  for (const [property, values] of [
    ['CONNECTION', { CONNECT: true, DISCONNECT: false }],
    ['GEOGRAPHIC_COORD', { LAT: 33.45, LONG: phoenixLongitude, ELEV: 331 }],
    ['ON_COORD_SET', { TRACK: true, SLEW: false, SYNC: false }],
    ['EQUATORIAL_EOD_COORD', { RA: 0, DEC: 90 }],
  ] as const)
    camera.feed(wire((at += 1), 'def', 'primary', property, values, 'Ok'))

  const pointing = makePointing({
    picture: camera.picture,
    sender: {
      send: async command => {
        if (command.property === 'EQUATORIAL_EOD_COORD' && mode === 'SYNC' && options.refuseSync !== undefined) {
          sent.push({ property: command.property, values: command.values })

          return { result: 'refused', reason: options.refuseSync }
        }

        const outcome = await camera.sender.send(command)

        sent.push({ property: command.property, values: command.values })
        if (outcome.result !== 'written') return outcome
        if (command.property === 'ON_COORD_SET') mode = Object.entries(command.values).find(([, on]) => on === true)?.[0] ?? mode
        if (command.property === 'EQUATORIAL_EOD_COORD') {
          const reported = { raDegrees: Number(command.values['RA']) * 15, decDegrees: Number(command.values['DEC']) }

          if (mode === 'SYNC') {
            errorDegrees = pointed.decDegrees + errorDegrees - reported.decDegrees
            pointed = reported
            setTimeout(() => feedAll(wire((at += 1), 'set', 'primary', 'EQUATORIAL_EOD_COORD', command.values, 'Ok')), 1)
          } else {
            pointed = reported
            setTimeout(() => {
              feedAll(wire((at += 1), 'set', 'primary', 'EQUATORIAL_EOD_COORD', command.values, 'Busy'))
              setTimeout(() => feedAll(wire((at += 1), 'set', 'primary', 'EQUATORIAL_EOD_COORD', command.values, 'Ok')), 2)
            }, 2)
          }
        }

        return outcome
      },
    },
    settings: { mount: 'primary', searchResults: 10 },
    now: () => startedAt,
  })

  const centre = makeCentre({
    picture: camera.picture,
    pointing,
    capture: camera.capture,
    publish: (kind, body) => {
      published.push({ kind, body: { ...body } })
      feedAll({ seq: StreamPosition.make(0), kind: `vela.centre.${kind}`, at, body })
    },
    settings: { mount: 'primary', camera: 'primary', toleranceArcmin: options.toleranceArcmin ?? 1 },
    now: () => startedAt,
  })

  holder.centre = centre

  return { centre, camera, published, sent }
}

function until(check: () => boolean) {
  return new Promise<void>(resolve => {
    const timer = setInterval(() => {
      if (check()) {
        clearInterval(timer)
        resolve()
      }
    }, 5)
  })
}

const coordinateModes = (sent: ReadonlyArray<{ property: string; values: Values }>) => sent.filter(each => each.property === 'ON_COORD_SET').map(each => Object.entries(each.values).find(([, on]) => on === true)?.[0])

describe('slew and centre on a scripted mount that points 24 arcminutes off', () => {
  it('slews, solves, syncs the mount to the solve, slews again and ends once the solve is within the tolerance', async () => {
    const { centre, camera, published, sent } = scriptedMount({ errorDegrees: 0.4 })

    expect(centre.start({ id: 'ngc0224', exposureSeconds: 0.01 })).toEqual({ ok: true })

    await until(() => centre.view().ended !== undefined)

    const passes = centre.view().passes

    expect(centre.view()).toMatchObject({ ended: 'done', target: { id: 'ngc0224' }, problem: undefined })
    expect(passes).toHaveLength(2)
    expect(passes[0]).toMatchObject({ frame: 1, solved: true })
    expect(passes[0]!.solved && passes[0]!.offsetArcmin).toBeCloseTo(24, 0)
    expect(passes[0]!.solved && passes[0]!.northArcmin).toBeCloseTo(24, 0)
    expect(passes[0]!.solved && passes[0]!.mountArcmin).toBeCloseTo(24, 0)
    expect(passes[1]!.solved && passes[1]!.offsetArcmin).toBeLessThan(0.01)
    expect(passes[1]!.solved && passes[1]!.mountArcmin).toBeLessThan(0.01)
    expect(coordinateModes(sent)).toEqual(['TRACK', 'SYNC', 'TRACK', 'TRACK'])
    expect(published.map(entry => entry.kind)).toEqual(['started', 'pass', 'pass'])
    expect(camera.events.at(-1)).toMatchObject({ kind: 'ended', body: { reason: 'done', detail: 'centred on Andromeda Galaxy, 0″ from it after 2 frames' } })
  })

  it('ends after the first frame when the goto already landed within the tolerance, with no sync', async () => {
    const { centre, sent } = scriptedMount({ errorDegrees: 0.01 })

    expect(centre.start({ id: 'ngc0224', exposureSeconds: 0.01 })).toEqual({ ok: true })

    await until(() => centre.view().ended !== undefined)

    expect(centre.view()).toMatchObject({ ended: 'done', passes: [{ frame: 1, solved: true }] })
    expect(coordinateModes(sent)).toEqual(['TRACK'])
  })

  it('takes another frame at the same place when one does not solve, and says so in the passes', async () => {
    const { centre, sent } = scriptedMount({ errorDegrees: 0.4, unsolved: [1] })

    expect(centre.start({ id: 'ngc0224', exposureSeconds: 0.01 })).toEqual({ ok: true })

    await until(() => centre.view().ended !== undefined)

    expect(centre.view()).toMatchObject({ ended: 'done', passes: [{ frame: 1, solved: false, reason: 'Not enough stars.' }, { frame: 2, solved: true }, { frame: 3, solved: true }] })
    expect(coordinateModes(sent)).toEqual(['TRACK', 'SYNC', 'TRACK', 'TRACK'])
  })

  it('waits for Stop with the reason on the page when the mount refuses the sync, and puts the mode back to TRACK', async () => {
    const { centre, camera, sent } = scriptedMount({ errorDegrees: 0.4, refuseSync: 'not now' })

    expect(centre.start({ id: 'ngc0224', exposureSeconds: 0.01 })).toEqual({ ok: true })

    await until(() => centre.view().problem !== undefined)

    expect(centre.view().problem).toBe('sync to the solve of frame 1: EQUATORIAL_EOD_COORD: not now')
    expect(centre.view().ended).toBeUndefined()
    expect(coordinateModes(sent)).toEqual(['TRACK', 'SYNC', 'TRACK'])

    await camera.capture.stop()
    await until(() => centre.view().ended !== undefined)

    expect(centre.view().ended).toBe('stopped')
  })

  it('refuses a target that is not in the catalog', () => {
    const { centre } = scriptedMount({ errorDegrees: 0 })

    expect(centre.start({ id: 'nowhere', exposureSeconds: 1 })).toEqual({ ok: false, reason: 'no catalog target nowhere' })
  })
})
