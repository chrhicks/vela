import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readFrameRecords } from '@vela/rig-frames'
import { dataDirectory, recordLine, writeRecords } from './support.ts'

describe('readFrameRecords', () => {
  it('reads records with and without an image, defaulting the frame type to light', async () => {
    const dir = await dataDirectory()

    const path = await writeRecords(dir, [
      recordLine({ index: 1, capturedAt: '2026-10-26T20:00:00.000Z' }),
      recordLine({ attempt: 2, outcome: 'stopped', startedAt: '2026-10-26T20:00:20.000Z' }),
    ])

    const { records, problems, incompleteTail } = await readFrameRecords(path)

    expect(problems).toEqual([])
    expect(incompleteTail).toBe(false)
    expect(records.map(record => [record.attempt, record.outcome, record.frameType, record.image?.width ?? null])).toEqual([
      [1, 'saved', 'light', 64],
      [2, 'stopped', 'light', null],
    ])
  })

  it('leaves out a last line that is still being written and names a bad line without quoting it', async () => {
    const dir = await dataDirectory()

    const path = await writeRecords(dir, [recordLine({ index: 1, capturedAt: '2026-10-26T20:00:00.000Z' }), 'SECRET-TEXT { broken', JSON.stringify({ version: 2, secret: 'SECRET-TEXT' })], '{"version":1,"rigId"')

    const { records, problems, incompleteTail } = await readFrameRecords(path)

    expect(records).toHaveLength(1)
    expect(incompleteTail).toBe(true)
    expect(problems.map(problem => [problem.line, problem.reason])).toEqual([
      [2, 'not JSON'],
      [3, 'does not match the schema'],
    ])
    expect(JSON.stringify(problems)).not.toContain('SECRET-TEXT')
  })

  it('reports a missing file', async () => {
    const dir = await dataDirectory()
    await writeFile(join(dir, 'present'), '')

    expect((await readFrameRecords(join(dir, 'frames.jsonl'))).problems.map(problem => problem.reason)).toEqual(['ENOENT'])
  })
})
