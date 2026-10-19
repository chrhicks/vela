import { join } from 'node:path'
import { DuckDBInstance, type Json } from '@duckdb/node-api'
import { sqlString } from './package.ts'
import { tableNames } from './schema.ts'

export interface OpenPackage {
  rows(sql: string): Promise<Record<string, Json>[]>
  close(): void
}

/** Opens a package read-only as one view per table, so a query reads like `SELECT * FROM frames`. */
export async function openPackage(directory: string): Promise<OpenPackage> {
  const instance = await DuckDBInstance.create(':memory:')
  const connection = await instance.connect()

  for (const name of tableNames) {
    const file = sqlString(join(directory, `${name}.parquet`))

    await connection.run(`CREATE VIEW "${name}" AS SELECT * FROM read_parquet('${file}')`)
  }

  return {
    rows: async sql => (await connection.runAndReadAll(sql)).getRowObjectsJson(),
    close: () => connection.closeSync(),
  }
}
