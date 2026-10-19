import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { checkContainment } from './containment.ts'

let watched: string

beforeEach(async () => {
  watched = await mkdtemp(join(tmpdir(), 'containment-test-'))
  await mkdir(join(watched, 'kept'))
  await writeFile(join(watched, 'kept', 'a.txt'), 'one')
})

afterEach(() => rm(watched, { recursive: true, force: true }))

const node = (script: string) => [process.execPath, '-e', script]

test('a command that writes only to TMPDIR leaves the watched folders as they were', async () => {
  const result = await checkContainment(node("require('fs').writeFileSync(require('path').join(process.env.TMPDIR, 'scratch'), 'x')"), [watched])

  expect(result.exitCode).toBe(0)
  expect(result.outside).toEqual({ added: [], removed: [], changed: [] })
  expect(result.leftInTemporaryFolder.map(path => path.split('/').at(-1))).toEqual(['scratch'])
})

test('a file added, a file changed and a file removed in a watched folder are each reported', async () => {
  const script = `const fs = require('fs'); const w = ${JSON.stringify(watched)}
    fs.writeFileSync(w + '/new.txt', 'n'); fs.writeFileSync(w + '/kept/a.txt', 'longer than before'); fs.mkdirSync(w + '/made')`

  const result = await checkContainment(node(script), [watched])

  expect(result.outside.added.map(path => path.slice(watched.length)).sort()).toEqual(['/made', '/new.txt'])
  expect(result.outside.changed.map(path => path.slice(watched.length))).toEqual(['/kept/a.txt'])
  expect(result.outside.removed).toEqual([])
})

test('the exit code of the command is passed on', async () => {
  expect((await checkContainment(node('process.exit(7)'), [watched])).exitCode).toBe(7)
})
