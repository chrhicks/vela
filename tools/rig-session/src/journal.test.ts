import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { criaEvent, encodeEvent, rigId, sourceId, type CriaEntry } from '@vela/rig-events'
import { mountState } from '@vela/rig-testing'
import { readJournal } from './journal.ts'
import { sanitizeText, Secrets } from './sanitize.ts'

const exchange = {
  kind: 'exchange',
  at: Date.parse('2030-01-01T01:00:00Z'),
  ms: 11,
  method: 'POST',
  route: '/v2/operations',
  status: 202,
  command: { requestId: 'request-1', deviceId: 'primary', kind: 'capture', parameters: { exposureSeconds: 50 } },
  reply: { kind: 'answered', body: { id: 'operation-1' } },
  origin: 'http://cria.example.test:4319',
}

const image = { kind: 'image', at: Date.parse('2030-01-01T01:01:00Z'), imageId: 'image-1', operationId: 'operation-1', bytes: 5000, sha256: 'sha', verdict: 'intact', origin: 'x' }

test('the journal reads exchanges, image checks, state changes and stream events, passes over other kinds, and lists the lines it cannot read', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'rig-session-journal-')), 'cria-journal.jsonl')

  await writeFile(
    file,
    [
      exchange,
      { kind: 'state', at: 1, generatedAt: 1, sequence: 1, instanceId: 'i', baseline: true, changed: { 'device/a/availability': 'up' }, removed: [], origin: 'x' },
      { kind: 'stream', at: 2, event: 'opened', message: null },
      { kind: 'metrics', at: 3 },
      image,
      { ...image, verdict: 'vanished' },
      { ...exchange, reply: { kind: 'lost', message: 'reset' }, status: null, command: null },
    ]
      .map(line => `${JSON.stringify(line)}\n`)
      .join('') + '{"kind":"image","at":',
  )

  const { items, skipped } = await readJournal(file)

  expect(items.map(entry => entry.kind)).toEqual(['exchange', 'state', 'stream', 'image', 'exchange'])
  expect(JSON.stringify(items)).not.toContain('example.test')
  expect(skipped.map(entry => entry.where)).toEqual([`${file}:6`, `${file}:8`])
})

test('a journal is streamed and only the entries inside the window are kept; the origin is learned and never kept', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'rig-session-journal-')), 'cria-journal.jsonl')
  const secrets = new Secrets()
  const day = (n: number) => Date.parse('2030-01-01T01:00:00Z') + n * 86_400_000

  await writeFile(file, Array.from({ length: 3000 }, (_, n) => `${JSON.stringify({ ...exchange, at: day(n % 3) })}\n`).join('') + 'x'.repeat(2000) + '\n')

  const { items, skipped } = await readJournal(file, { inWindow: time => time.getTime() === day(1), secrets })

  expect(items).toHaveLength(1000)
  expect(skipped.map(entry => entry.reason)).toEqual(['not JSON'])
  expect(sanitizeText('cannot reach http://cria.example.test:4319/v2 or cria.example.test', secrets)).toBe('cannot reach [redacted]/v2 or [redacted]')
})

test('a journal of lines that do not decode lists a bounded number of them', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'rig-session-journal-')), 'cria-journal.jsonl')

  await writeFile(file, `${'garbage\n'.repeat(1500)}`)

  const { skipped } = await readJournal(file)

  expect(skipped).toHaveLength(1001)
  expect(skipped.at(-1)?.reason).toBe('500 more lines did not decode and are not listed')
})

const start = Date.parse('2030-01-01T01:00:00Z')

const runLogLine = (entry: CriaEntry) => encodeEvent(criaEvent(entry, { rig: rigId('test-rig'), source: sourceId('vela:cria') }))

const snapshot = (index: number, raHours = 5) => mountState({ sequence: index, generatedAt: start + index * 1000, mount: { at: start + index * 1000, raHours, decDegrees: -5 } })

const origin = 'http://cria.example.test:4319'

async function runLogFiles() {
  const directory = join(await mkdtemp(join(tmpdir(), 'rig-session-run-log-')), 'run-log')

  await mkdir(directory)

  await writeFile(
    join(directory, 'run-20300101T010000000Z-00001.jsonl'),
    [
      runLogLine({ kind: 'stream', at: start, origin, event: 'opened', message: null }),
      runLogLine({ kind: 'state', at: start + 40, origin, state: snapshot(0) }),
      runLogLine({ kind: 'state', at: start + 1040, origin, state: snapshot(1) }),
      runLogLine({ kind: 'state', at: start + 2040, origin, state: snapshot(2, 5.5) }),
    ]
      .map(line => `${line}\n`)
      .join('') + '{"at":',
  )

  await writeFile(
    join(directory, 'run-20300101T010000000Z-00002.jsonl'),
    `${runLogLine({ kind: 'exchange', at: start + 3000, origin, ms: 11, method: 'GET', route: '/v2/state', status: null, command: null, reply: { kind: 'lost', message: 'reset' } })}\n`,
  )

  await writeFile(join(directory, 'notes.txt'), 'not a run-log file\n')

  return directory
}

test('a run-log directory reads like a journal: entries by when Vela saw them, snapshots cut to the cells that changed', async () => {
  const directory = await runLogFiles()
  const { items, skipped } = await readJournal(directory)
  const states = items.flatMap(entry => (entry.kind === 'state' ? [entry] : []))

  expect(items.map(entry => entry.kind)).toEqual(['stream', 'state', 'state', 'state', 'exchange'])
  expect(items.map(entry => entry.at.getTime())).toEqual([start, start + 40, start + 1040, start + 2040, start + 3000])
  expect(states.map(entry => entry.baseline)).toEqual([true, false, false])
  expect(states.map(entry => entry.sequence)).toEqual([0, 1, 2])
  expect(Object.keys(states[0]?.changed ?? {})).toContain('device/mount/readings.rightAscensionHours')
  expect(Object.keys(states[1]?.changed ?? {})).toEqual([])
  expect(Object.keys(states[2]?.changed ?? {})).toEqual(['device/mount/readings.rightAscensionHours'])
  expect(skipped.map(entry => entry.where)).toEqual([`${directory}/run-20300101T010000000Z-00001.jsonl:5`])
})

test('a run-log file read alone gives the same entries as the directory holds for it', async () => {
  const directory = await runLogFiles()
  const { items } = await readJournal(join(directory, 'run-20300101T010000000Z-00001.jsonl'))

  expect(items.map(entry => entry.kind)).toEqual(['stream', 'state', 'state', 'state'])
})

test('a run log is windowed by when Vela saw each entry, and its origin is learned and never kept', async () => {
  const directory = await runLogFiles()
  const secrets = new Secrets()
  const { items } = await readJournal(directory, { inWindow: time => time.getTime() >= start + 1000, secrets })

  expect(items.map(entry => entry.kind)).toEqual(['state', 'state', 'exchange'])
  expect(JSON.stringify(items)).not.toContain('example.test')
  expect(sanitizeText('cannot reach http://cria.example.test:4319/v2', secrets)).toBe('cannot reach [redacted]/v2')
})

test('a run-log line of a kind the packager does not use is passed over, and one that does not decode is listed', async () => {
  const file = join(await mkdtemp(join(tmpdir(), 'rig-session-run-log-')), 'run-20300101T010000000Z-00001.jsonl')
  const gap = JSON.stringify({ v: 1, id: 'x', kind: 'gap', rig: 'test-rig', source: 'vela:cria', at: start, seenAt: start, body: {} })
  const damaged = JSON.stringify({ v: 1, id: 'y', kind: 'cria.state', rig: 'test-rig', source: 'vela:cria', at: start, seenAt: start, body: { origin, state: {} } })

  await writeFile(file, `${gap}\n${damaged}\n${runLogLine({ kind: 'stream', at: start, origin, event: 'ended', message: 'closed' })}\n`)

  const { items, skipped } = await readJournal(file)

  expect(items.map(entry => entry.kind)).toEqual(['stream'])
  expect(skipped.map(entry => entry.where)).toEqual([`${file}:2`])
})
