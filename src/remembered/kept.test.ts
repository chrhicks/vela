import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { entry } from '../../state/testing.ts'
import { keep, readKept } from './kept.ts'
import { lastCentreNear, nothingRemembered, remember, type Remembered } from './remembered.ts'

const folder = () => mkdtemp(join(tmpdir(), 'vela-remembered-'))

const day = 86_400_000

const earlier: Remembered = {
  lastLight: { exposureSeconds: 60, frames: undefined, at: 1 * day },
  cameraAngle: { degrees: 109.2, at: 1 * day },
  centres: [{ run: 'centre-a', raDegrees: 23.4531, decDegrees: 30.6442, at: 1 * day, reached: true }],
}

describe('what Vela remembers, kept in a file', () => {
  it('reads back what it kept', async () => {
    const path = join(await folder(), 'deeper', 'remembered.json')

    await Effect.runPromise(keep(path, earlier))

    expect(await Effect.runPromise(readKept(path))).toEqual(earlier)
    expect(await Effect.runPromise(keep(path, nothingRemembered).pipe(Effect.andThen(readKept(path))))).toEqual(nothingRemembered)
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
})
