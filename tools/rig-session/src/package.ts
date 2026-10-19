import { mkdir, readdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import { z } from 'zod'
import { cellLeaks, sanitizeJson, sanitizeRow, type Cell, type Json, type Secrets } from './sanitize.ts'
import { createTableSql, tableNames, type AnyColumn, tables as schemas, type TableRows } from './schema.ts'

/** A cell of the staged package held what a package must not. Names the table, column and rule, never the value. */
export class PrivacyCheckError extends Error {
  constructor(readonly findings: readonly string[]) {
    super(`the package holds what it must not (${findings.join('; ')}); nothing was published`)
  }
}

type RowSanitizer = typeof sanitizeRow

/**
 * Writes one Parquet file per table, plus `session.json`, into a fresh directory under
 * `<root>/builds`, then points `<root>/package` at it with one rename. A build that stops
 * anywhere earlier leaves the previous package untouched. The next build that finishes removes
 * every other directory under `builds`, including the debris of one that did not.
 *
 * This is the one place rows leave the packager. Every string cell, and every string inside a JSON
 * cell, is sanitised on the way out, whichever table or column it is in. Before the switch the staged
 * files are read back and checked for the learned secrets and the private-looking patterns; a hit
 * fails the build and removes the staging directory. `sanitize` is replaceable only so a test can show
 * that check failing closed.
 */
export async function publishPackage(root: string, tables: TableRows, summary: Json, secrets: Secrets, sanitize: RowSanitizer = sanitizeRow): Promise<string> {
  const builds = join(root, 'builds')
  const id = new Date().toISOString().replaceAll(/[:.]/g, '-')
  const staging = join(builds, `.building-${id}`)
  const finished = join(builds, id)

  await mkdir(builds, { recursive: true })
  await mkdir(staging)
  await writeParquet(staging, tables, secrets, sanitize)
  await writeFile(join(staging, 'session.json'), `${JSON.stringify(sanitizeJson(summary, secrets), null, 2)}\n`)

  const findings = await findLeaks(staging, secrets)

  if (findings.length > 0) {
    await rm(staging, { recursive: true })

    throw new PrivacyCheckError(findings)
  }

  await rename(staging, finished)

  await rm(join(root, 'package.next'), { force: true })
  await symlink(join('builds', id), join(root, 'package.next'))
  await rename(join(root, 'package.next'), join(root, 'package'))
  await removeOtherBuilds(builds, id)

  return finished
}

async function writeParquet(directory: string, tables: TableRows, secrets: Secrets, sanitize: RowSanitizer): Promise<void> {
  const instance = await DuckDBInstance.create(':memory:')
  const connection = await instance.connect()

  try {
    for (const name of tableNames) {
      const rows = join(directory, `${name}.jsonl`)
      const exported: readonly Readonly<Record<string, Cell>>[] = tables[name]

      await connection.run(createTableSql(name))
      await writeFile(rows, exported.map(row => JSON.stringify(sanitize(row, schemas[name], secrets))).join('\n'))

      if (exported.length > 0) await connection.run(`COPY "${name}" FROM '${sqlString(rows)}' (FORMAT json)`)

      await connection.run(
        `COPY (SELECT * FROM "${name}" ORDER BY ALL) TO '${sqlString(join(directory, `${name}.parquet`))}' (FORMAT parquet)`,
      )
      await rm(rows)
    }
  } finally {
    connection.closeSync()
  }
}

/** Reads the staged Parquet files and `session.json` back and lists where a string cell still leaks. */
async function findLeaks(directory: string, secrets: Secrets): Promise<string[]> {
  const instance = await DuckDBInstance.create(':memory:')
  const connection = await instance.connect()
  const findings: string[] = []

  try {
    for (const name of tableNames) {
      const schema: Readonly<Record<string, AnyColumn>> = schemas[name]
      const strings = Object.entries(schema).filter(([, { kind }]) => kind === 'text' || kind === 'json' || kind === 'link')

      if (strings.length === 0) continue

      const select = strings.map(([column]) => `"${column}"`).join(', ')
      const rows = (await connection.runAndReadAll(`SELECT ${select} FROM read_parquet('${sqlString(join(directory, `${name}.parquet`))}')`)).getRowObjectsJson()

      for (const row of rows) {
        for (const [column, cell] of Object.entries(row)) {
          const text = z.string().safeParse(cell)

          if (text.success) findings.push(...cellLeaks(text.data, schema[column], secrets).map(rule => `${name}.${column}: ${rule}`))
        }
      }
    }
  } finally {
    connection.closeSync()
  }

  findings.push(...cellLeaks(await readFile(join(directory, 'session.json'), 'utf8'), { kind: 'json', nullable: false }, secrets).map(rule => `session.json: ${rule}`))

  return [...new Set(findings)]
}

async function removeOtherBuilds(builds: string, current: string): Promise<void> {
  for (const entry of await readdir(builds)) {
    if (entry !== current) await rm(join(builds, entry), { recursive: true })
  }
}

export function sqlString(text: string): string {
  return text.replaceAll("'", "''")
}
