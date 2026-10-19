import { mkdtemp, readdir, readFile, readlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { expect, test } from 'vitest'
import { PrivacyCheckError, publishPackage } from './package.ts'
import { openPackage } from './query.ts'
import { Secrets, type Cell } from './sanitize.ts'
import { tableNames, tables as schemas, type TableName, type TableRows } from './schema.ts'

const scratch = () => mkdtemp(join(tmpdir(), 'rig-session-privacy-'))

const planted = {
  text: 'open /dev/serial/by-id/usb-Test_0001 and LAT=12.5 LONG=345.25 at 12.534, 12:32:02.4 and 12°32\'02.4"',
  json: JSON.stringify({ note: ['/dev/ttyUSB0', { deeper: 'usb-Test_0001-if00 12.534' }] }),
}

/** A row with a planted secret in every text, link and JSON column, however the table names them. */
const leakyRow = (name: TableName): Record<string, Cell> =>
  Object.fromEntries(
    Object.entries(schemas[name]).map(([column, { kind }]) => [
      column,
      kind === 'json' ? planted.json : kind === 'text' || kind === 'link' ? planted.text : kind === 'timestamp' ? new Date('2030-01-01T01:00:00Z') : kind === 'bool' ? true : 1,
    ]),
  )

/** Naming each table keeps this test honest: a table added to the schema is a type error here until it is covered. */
const emptyTables = (): TableRows => ({ frames: [], attempts: [], mount: [], spans: [], indi_ops: [] })

const leakyTables = (): TableRows => ({ frames: [leakyRow('frames')], attempts: [leakyRow('attempts')], mount: [leakyRow('mount')], spans: [leakyRow('spans')], indi_ops: [leakyRow('indi_ops')] })

function secrets() {
  const learned = new Secrets()

  learned.addCoordinate('latitude', 12.534)

  return learned
}

test('no cell of any table reaches the package with a secret in it, whichever column holds it', async () => {
  const root = await scratch()

  await publishPackage(root, leakyTables(), { note: 'built from /dev/ttyUSB0' }, secrets())

  const session = await openPackage(join(root, 'package'))

  for (const name of tableNames) {
    const cells = JSON.stringify(await session.rows(`SELECT * FROM ${name}`))

    expect(cells, name).not.toMatch(/ttyUSB0|Test_0001|12\.5|345\.25|12\.534|12:32|12°32/)
    expect(cells, name).toContain('[redacted]')
  }

  session.close()
})

test('the check after the write fails the build closed when a cell still leaks, and the old package stays readable', async () => {
  const root = await scratch()
  const first = await publishPackage(root, emptyTables(), {}, secrets())
  const leaky = (row: Readonly<Record<string, Cell>>) => row

  await expect(publishPackage(root, leakyTables(), {}, secrets(), leaky)).rejects.toBeInstanceOf(PrivacyCheckError)
  await expect(publishPackage(root, leakyTables(), {}, secrets(), leaky)).rejects.toThrow(/attempts\.message: serial path/)

  expect(await readlink(join(root, 'package'))).toBe(join('builds', basename(first)))
  expect(await readdir(join(root, 'builds'))).toEqual([basename(first)])

  const session = await openPackage(join(root, 'package'))

  expect(await session.rows('SELECT count(*) AS n FROM frames')).toEqual([{ n: '0' }])
  session.close()
})

test('session.json is sanitised like a table', async () => {
  const root = await scratch()
  const directory = await publishPackage(root, emptyTables(), { skipped: [{ reason: 'bad line near 12.534 on /dev/ttyUSB0' }] }, secrets())

  expect(JSON.parse(await readFile(join(directory, 'session.json'), 'utf8'))).toEqual({ skipped: [{ reason: 'bad line near [redacted] on [redacted]' }] })
})
