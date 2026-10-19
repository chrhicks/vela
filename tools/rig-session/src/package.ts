import { mkdir, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import { createTableSql, tableNames, type Tables } from './schema.ts'

/**
 * Writes one Parquet file per table, plus `session.json`, into a fresh directory under
 * `<root>/builds`, then points `<root>/package` at it with one rename. A build that stops
 * anywhere earlier leaves the previous package untouched. The next build that finishes removes
 * every other directory under `builds`, including the debris of one that did not.
 */
export async function publishPackage(root: string, tables: Tables, summary: string): Promise<string> {
  const builds = join(root, 'builds')
  const id = new Date().toISOString().replaceAll(/[:.]/g, '-')
  const staging = join(builds, `.building-${id}`)
  const finished = join(builds, id)

  await mkdir(builds, { recursive: true })
  await mkdir(staging)
  await writeParquet(staging, tables)
  await writeFile(join(staging, 'session.json'), summary)
  await rename(staging, finished)

  await rm(join(root, 'package.next'), { force: true })
  await symlink(join('builds', id), join(root, 'package.next'))
  await rename(join(root, 'package.next'), join(root, 'package'))
  await removeOtherBuilds(builds, id)

  return finished
}

async function writeParquet(directory: string, tables: Tables): Promise<void> {
  const instance = await DuckDBInstance.create(':memory:')
  const connection = await instance.connect()

  try {
    for (const name of tableNames) {
      const rows = join(directory, `${name}.jsonl`)

      await connection.run(createTableSql(name))
      await writeFile(rows, tables[name].map(row => JSON.stringify(row)).join('\n'))

      if (tables[name].length > 0) await connection.run(`COPY "${name}" FROM '${sqlString(rows)}' (FORMAT json)`)

      await connection.run(
        `COPY (SELECT * FROM "${name}" ORDER BY ALL) TO '${sqlString(join(directory, `${name}.parquet`))}' (FORMAT parquet)`,
      )
      await rm(rows)
    }
  } finally {
    connection.closeSync()
  }
}

async function removeOtherBuilds(builds: string, current: string): Promise<void> {
  for (const entry of await readdir(builds)) {
    if (entry !== current) await rm(join(builds, entry), { recursive: true })
  }
}

export function sqlString(text: string): string {
  return text.replaceAll("'", "''")
}
