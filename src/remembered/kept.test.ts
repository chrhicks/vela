import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { entry } from '../../state/testing.ts'
import { keep, readKept } from './kept.ts'
import { lastCentreNear, nothingRemembered, remember, shortlistOf, type Remembered } from './remembered.ts'

const folder = () => mkdtemp(join(tmpdir(), 'vela-remembered-'))

const day = 86_400_000

const earlier: Remembered = {
  lastLight: { exposureSeconds: 60, frames: undefined, at: 1 * day },
  cameraAngle: { degrees: 109.2, at: 1 * day },
  centres: [{ run: 'centre-a', raDegrees: 23.4531, decDegrees: 30.6442, at: 1 * day, reached: true }],
  camera: { on: true, setpoint: -10, sensorCelsius: undefined, wrote: 1 * day },
  targetCoolers: [{ target: 'orion', setting: { state: 'on', celsius: -10 }, at: 1 * day }],
  lastCooler: { setting: { state: 'on', celsius: -10 }, at: 1 * day },
  lightRun: undefined,
  lightTargets: [{ target: 'orion', at: 1 * day }],
  shortlist: ['orion', 'triangulum'],
}

describe('what Vela remembers, kept in a file', () => {
  it('reads back what it kept', async () => {
    const path = join(await folder(), 'deeper', 'remembered.json')

    await Effect.runPromise(keep(path, earlier))

    expect(await Effect.runPromise(readKept(path))).toEqual(earlier)
    expect(await Effect.runPromise(keep(path, nothingRemembered).pipe(Effect.andThen(readKept(path))))).toEqual(nothingRemembered)
  })

  it('reads a file kept before the cooler was remembered, as remembering no cooler', async () => {
    const path = join(await folder(), 'remembered.json')

    await writeFile(path, JSON.stringify({ lastLight: null, cameraAngle: null, centres: [] }))

    expect(await Effect.runPromise(readKept(path))).toEqual(nothingRemembered)
  })

  it('remembers nothing when there is no file yet', async () => {
    expect(await Effect.runPromise(readKept(join(await folder(), 'remembered.json')))).toEqual(nothingRemembered)
  })

  it('says the file is unreadable when it does not hold what Vela keeps', async () => {
    const path = join(await folder(), 'remembered.json')

    await writeFile(path, '{"centres":"none"}')

    expect(await Effect.runPromise(Effect.flip(readKept(path)))).toMatchObject({ _tag: 'RememberedUnreadable', path })
    expect(await readFile(path, 'utf8')).toBe('{"centres":"none"}')
  })

  it('still offers a framing after the stream has let go of it, with what the stream holds now on top', async () => {
    const path = join(await folder(), 'remembered.json')

    await Effect.runPromise(keep(path, earlier))

    const fromStream = [
      entry('vela.centre.pass', 9 * day, { run: 'centre-b', frame: 2, solved: true, raDegrees: 350.2012, decDegrees: 61.2017, rotationDegrees: -71 }),
      entry('vela.run.ended', 9 * day + 1, { run: 'centre-b', reason: 'done' }),
      entry('vela.run.started', 9 * day + 2, { run: 'light-b', object: 'NGC 7635', frameType: 'light', exposureSeconds: 120, count: 40 }),
    ]
    const remembered = fromStream.reduce(remember, await Effect.runPromise(readKept(path)))

    expect(lastCentreNear(remembered, { raDegrees: 23.4621, decDegrees: 30.6599 }, 1.1)).toMatchObject({ run: 'centre-a', at: 1 * day })
    expect(lastCentreNear(remembered, { raDegrees: 350.2012, decDegrees: 61.2017 }, 1.1)).toMatchObject({ run: 'centre-b' })
    expect(remembered.cameraAngle).toEqual({ degrees: -71, at: 9 * day })
    expect(remembered.lastLight).toEqual({ exposureSeconds: 120, frames: 40, at: 9 * day + 2 })
  })

  it('keeps an emptied shortlist apart from one never edited', async () => {
    const path = join(await folder(), 'remembered.json')

    await Effect.runPromise(keep(path, { ...earlier, shortlist: [] }))
    expect((await Effect.runPromise(readKept(path))).shortlist).toEqual([])

    await Effect.runPromise(keep(path, { ...earlier, shortlist: undefined }))
    expect((await Effect.runPromise(readKept(path))).shortlist).toBeUndefined()
    expect(JSON.parse(await readFile(path, 'utf8'))).not.toHaveProperty('shortlist')
  })

  it('reads a file kept before the shortlist as never edited, with no target imaged', async () => {
    const path = join(await folder(), 'remembered.json')

    await writeFile(path, JSON.stringify({ lastLight: null, cameraAngle: null, centres: [], camera: null, targetCoolers: [], lastCooler: null }))

    expect(await Effect.runPromise(readKept(path))).toMatchObject({ shortlist: undefined, lightTargets: [] })
  })

  it('replays the stream over a kept shortlist to the same list, and carries a later edit on from it', async () => {
    const path = join(await folder(), 'remembered.json')
    const stream = [
      entry('vela.shortlist', 3 * day, { target: 'soul', action: 'add', from: ['orion'] }),
      entry('vela.shortlist', 3 * day + 1, { target: 'orion', action: 'remove' }),
      entry('vela.shortlist', 3 * day + 2, { target: 'pinwheel', action: 'add' }),
    ]
    const afterRestart = stream.reduce(remember, nothingRemembered)

    await Effect.runPromise(keep(path, afterRestart))

    const kept = await Effect.runPromise(readKept(path))
    const replayed = stream.reduce(remember, kept)
    const later = remember(replayed, entry('vela.shortlist', 4 * day, { target: 'triangulum', action: 'add' }))

    expect(afterRestart.shortlist).toEqual(['soul', 'pinwheel'])
    expect(replayed.shortlist).toEqual(['soul', 'pinwheel'])
    expect(later.shortlist).toEqual(['soul', 'pinwheel', 'triangulum'])
  })

  it('keeps which targets were imaged and when, so the default list survives the stream letting go of the runs', async () => {
    const path = join(await folder(), 'remembered.json')
    const light = (at: number, run: string, id: string) => [
      entry('vela.run.started', at, { run, object: id, frameType: 'light', exposureSeconds: 60, target: { id, name: id, raDegrees: 83.82, decDegrees: -5.39 } }),
      entry('vela.run.exposed', at + 1, { run, frame: 1 }),
    ]

    await Effect.runPromise(keep(path, [...light(1 * day, 'a', 'orion'), ...light(2 * day, 'b', 'triangulum')].reduce(remember, nothingRemembered)))

    const kept = await Effect.runPromise(readKept(path))
    const later = light(3 * day, 'c', 'soul').reduce(remember, kept)

    expect(shortlistOf(kept, 5)).toEqual(['triangulum', 'orion'])
    expect(shortlistOf(later, 5)).toEqual(['soul', 'triangulum', 'orion'])
  })
})
