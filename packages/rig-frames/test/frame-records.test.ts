import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { encodeEvent, rigId, seal, sourceId } from '@vela/rig-events'
import { frameDraft, readFrameRecords } from '@vela/rig-frames'
import { criaEvent } from '@vela/rig-events'
import { mountState } from '@vela/rig-testing'
import { dataDirectory, recordLine, rigName, writeRecords } from './support.ts'

describe('readFrameRecords', () => {
  it('reads records with and without an image, defaulting the frame type to light', async () => {
    const dir = await dataDirectory()

    const path = await writeRecords(dir, [
      recordLine({ index: 1, capturedAt: '2026-10-26T20:00:00.000Z' }),
      recordLine({ attempt: 2, outcome: 'stopped', startedAt: '2026-10-26T20:00:20.000Z' }),
    ])

    const { records, problems, incompleteTail } = await readFrameRecords([path])

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

    const { records, problems, incompleteTail } = await readFrameRecords([path])

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

    expect((await readFrameRecords([join(dir, 'frames.jsonl')])).problems.map(problem => problem.reason)).toEqual(['ENOENT'])
  })
})

describe('readFrameRecords on a run log', () => {
  const spec = { index: 1, capturedAt: '2026-10-26T20:00:00.000Z' }

  async function runLogWith(dir: string, lines: readonly string[], name = 'run-20261026T200000000Z-00001.jsonl') {
    await mkdir(join(dir, 'run-log'), { recursive: true })
    await writeFile(join(dir, 'run-log', name), lines.map(line => `${line}\n`).join(''))

    return join(dir, 'run-log')
  }

  const state = encodeEvent(criaEvent({ kind: 'state', at: 1, origin: 'http://cria.test', state: mountState({ sequence: 1, generatedAt: 1, mount: { at: 1, raHours: 5.5, decDegrees: -5.4 } }) }, { rig: rigId(rigName), source: sourceId('vela:cria') }))

  it('returns the record an old frames.jsonl line gives, from the frame event of the same attempt', async () => {
    const dir = await dataDirectory()
    const old = await readFrameRecords([await writeRecords(dir, [recordLine(spec)])])
    const [record] = old.records
    const event = encodeEvent(seal(frameDraft(record!, undefined, rigId(rigName), sourceId('vela:capture'))))
    const log = await runLogWith(dir, [state, event, state])
    const now = await readFrameRecords([log])

    expect(now.problems).toEqual([])
    expect(now.records).toEqual([{ ...record, line: 2 }])
    expect(record?.provenance).toEqual({ requestId: 'r', operationId: 'o', imageId: 'cria-side-id' })
  })

  it('reads old files and run logs together, keeps a repeated event once and says why an attempt failed', async () => {
    const dir = await dataDirectory()
    const old = await writeRecords(dir, [recordLine(spec)])
    const [record] = (await readFrameRecords([old])).records
    const failed = { ...record!, attempt: 9, outcome: 'failed' as const, message: 'Cria restarted', image: null }
    const first = encodeEvent(seal(frameDraft(failed, undefined, rigId(rigName), sourceId('vela:capture'))))
    const log = await runLogWith(dir, [first, state], 'run-20261026T200000000Z-00001.jsonl')

    await writeFile(join(log, 'run-20261026T200000000Z-00002.jsonl'), `${first}\n${first.slice(0, 20)}`)

    const both = await readFrameRecords([old, log])

    expect(both.records.map(item => [item.attempt, item.outcome, item.message])).toEqual([
      [1, 'saved', null],
      [9, 'failed', 'Cria restarted'],
    ])
    expect(both.incompleteTail).toBe(true)
    expect(both.problems).toEqual([])
  })

  it('names a frame event that does not match the schema without quoting it', async () => {
    const dir = await dataDirectory()
    const bad = '{"at":1,"body":{"secret":"SECRET-TEXT"},"id":"x","kind":"frame","rig":"r","seenAt":1,"source":"s","v":1}'
    const { problems, records } = await readFrameRecords([await runLogWith(dir, [bad])])

    expect(records).toEqual([])
    expect(problems.map(problem => [problem.line, problem.reason])).toEqual([[1, 'does not match the schema']])
    expect(JSON.stringify(problems)).not.toContain('SECRET-TEXT')
  })
})
