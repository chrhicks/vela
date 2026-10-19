import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import { expect, test } from 'vitest'

test('Parquet keeps timestamps, nulls and 64-bit integers through DuckDB', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rig-session-spike-'))
  const file = join(dir, 'frames.parquet')
  const instance = await DuckDBInstance.create(':memory:')
  const connection = await instance.connect()

  await connection.run(`
    CREATE TABLE frames (seen_at TIMESTAMP, stars BIGINT, hfr DOUBLE, label VARCHAR);
    INSERT INTO frames VALUES
      (TIMESTAMP '2026-10-18 03:31:00.123456', 9007199254740993, 3.5, 'a'),
      (TIMESTAMP '2026-10-18 03:32:00', NULL, NULL, NULL),
      (NULL, -9223372036854775808, 0.25, 'c');
  `)
  await connection.run(`COPY (SELECT * FROM frames ORDER BY seen_at NULLS LAST) TO '${file}' (FORMAT PARQUET)`)

  const result = await connection.runAndReadAll(`
    SELECT strftime(seen_at, '%Y-%m-%dT%H:%M:%S.%f') AS seen_at, stars::VARCHAR AS stars, hfr, label
    FROM read_parquet('${file}')
  `)

  expect(result.getRowObjectsJson()).toEqual([
    { seen_at: '2026-10-18T03:31:00.123456', stars: '9007199254740993', hfr: 3.5, label: 'a' },
    { seen_at: '2026-10-18T03:32:00.000000', stars: null, hfr: null, label: null },
    { seen_at: null, stars: '-9223372036854775808', hfr: 0.25, label: 'c' },
  ])

  connection.closeSync()
  await rm(dir, { recursive: true })
})
