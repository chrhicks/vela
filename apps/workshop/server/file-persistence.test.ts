import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_SESSION } from '@vela/ui/themes'
import { writeJsonAtomic } from './file-persistence'

const directories: string[] = []

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'vela-workshop-persistence-'))
  directories.push(directory)

  return directory
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('atomic workshop JSON writes', () => {
  it('keeps complete snapshots readable while differently sized saves overlap', async () => {
    const directory = await temporaryDirectory()
    const path = join(directory, 'session.json')
    const initial = { ...DEFAULT_SESSION, props: { index: -1, payload: 'initial' } }
    await writeJsonAtomic(path, initial)

    const snapshots = Array.from({ length: 24 }, (_, id) => ({
      ...initial,
      props: { index: id, payload: String.fromCharCode(65 + id).repeat((id + 1) * 32_768) }
    }))

    const expected = new Map([initial, ...snapshots].map(value => [value.props.index, value]))

    let saving = true

    const writes = Promise.allSettled(snapshots.map(value => writeJsonAtomic(path, value)))
      .finally(() => {
        saving = false
      })

    try {
      do {
        const snapshot = JSON.parse(await readFile(path, 'utf8'))
        expect(expected.get(snapshot.props.index)).toEqual(snapshot)
      } while (saving)
    } finally {
      await writes
    }

    expect((await writes).every(result => result.status === 'fulfilled')).toBe(true)
    const finalSnapshot = JSON.parse(await readFile(path, 'utf8'))
    expect(snapshots).toContainEqual(finalSnapshot)
    expect(await readdir(directory)).toEqual(['session.json'])

    await writeJsonAtomic(path, initial)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(initial)
  })

  it('removes a completed temporary file when replacement fails and preserves the destination', async () => {
    const directory = await temporaryDirectory()
    const path = join(directory, 'session.json')
    await mkdir(path)
    await writeFile(join(path, 'retained'), 'existing contents')

    await expect(writeJsonAtomic(path, DEFAULT_SESSION)).rejects.toThrow()

    expect(await readdir(directory)).toEqual(['session.json'])
    expect(await readFile(join(path, 'retained'), 'utf8')).toBe('existing contents')
  })
})
