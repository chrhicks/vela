import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { openFrameRecords, type FrameRecord } from './frame-records.js'

const record = (attempt: number): FrameRecord => ({
  version: 1,
  rigId: 'fra 400',
  runId: 'run-1',
  attempt,
  startedAt: '2026-10-17T03:00:00.000Z',
  settledAt: '2026-10-17T03:00:12.000Z',
  exposureSeconds: 10,
  frameType: 'light',
  subject: null,
  outcome: 'unsaved',
  message: null,
  provenance: null,
  image: null,
  statistics: null,
})

const directories: string[] = []

async function temporary() {
  const path = await mkdtemp(join(tmpdir(), 'vela-frame-records-test-'))

  directories.push(path)

  return path
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

it('appends one JSON line per record, in order, creating the directory', async () => {
  const path = join(await temporary(), 'nested', 'frames.jsonl')
  const records = openFrameRecords(path)

  records.append(record(1))
  records.append(record(2))
  await records.close()

  const lines = (await readFile(path, 'utf8')).trimEnd().split('\n')

  expect(lines.map(line => JSON.parse(line).attempt)).toEqual([1, 2])
})

it('turns off after a write fails, says so once, and never raises to the capture', async () => {
  const blocked = join(await temporary(), 'file')

  await writeFile(blocked, '')
  const onError = vi.fn()
  const records = openFrameRecords(join(blocked, 'frames.jsonl'), { onError })

  expect(() => {
    records.append(record(1))
    records.append(record(2))
  }).not.toThrow()
  await records.close()
  records.append(record(3))
  await records.close()

  expect(onError).toHaveBeenCalledTimes(1)
  expect(onError.mock.calls[0]![0]).toBeInstanceOf(Error)
})

it('turns off instead of queueing more than its byte bound while the disk is slow', async () => {
  const path = join(await temporary(), 'frames.jsonl')
  const onError = vi.fn()
  const line = Buffer.byteLength(JSON.stringify(record(1))) + 1
  const records = openFrameRecords(path, { maxPendingBytes: line * 2, onError })

  for (let attempt = 1; attempt <= 5; attempt++) records.append(record(attempt))
  await records.close()

  expect(onError).toHaveBeenCalledTimes(1)
  expect(onError.mock.calls[0]![0].message).toContain('fell behind')

  const written = (await readFile(path, 'utf8').catch(() => '')).trimEnd().split('\n').filter(Boolean)

  expect(written.length).toBeLessThanOrEqual(2)
})
