import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { operationsOf, readRecording } from './recording.ts'
import { linesOf } from './inputs.ts'
import { jsonLines, opLine, writeRecording } from './recording-fixture.ts'

const scratch = () => mkdtemp(join(tmpdir(), 'rig-session-recording-'))

const connected = { k: 'conn', t: 0, at: Date.parse('2030-01-01T00:59:00Z'), conn: 1, status: 'connected' }

const ended = { k: 'end', t: 5, at: Date.parse('2030-01-01T01:10:00Z') }

const capture = opLine({ id: 'operation-1', acceptedAt: '2030-01-01T01:00:00Z', settledAt: '2030-01-01T01:00:50Z' })

test('a recording reads its manifest and lines, and says it ended cleanly', async () => {
  const directory = await writeRecording(join(await scratch(), 'night'), jsonLines(connected, capture, ended))
  const recording = await readRecording(directory)

  expect(recording).toMatchObject({ name: 'night', instanceId: 'instance-1', ended: true, tornTail: false, skipped: [] })
  expect(recording.items.map(line => line.k)).toEqual(['op', 'end'])
  expect(recording.devices.map(device => device.indiDevice)).toEqual(['Test Camera', 'Test Mount'])
  expect(operationsOf(recording).map(operation => [operation.id, operation.acceptedAt, operation.outcome.value?.image?.id])).toEqual([
    ['operation-1', new Date('2030-01-01T01:00:00Z'), 'image-operation-1'],
  ])
})

test('a torn last line is dropped and a recording with no end line did not end', async () => {
  const directory = await writeRecording(join(await scratch(), 'night'), jsonLines(connected, capture))

  await writeFile(join(directory, 'traffic.jsonl'), `${JSON.stringify(connected)}\n${JSON.stringify(capture)}\n{"k":"msg","t":6`)

  const recording = await readRecording(directory)

  expect(recording).toMatchObject({ tornTail: true, ended: false, skipped: [] })
  expect(recording.items.map(line => line.k)).toEqual(['op'])
})

test('a damaged line in the middle keeps the lines before it, drops the rest and says so', async () => {
  const directory = await writeRecording(join(await scratch(), 'night'), [...jsonLines(connected), 'not json', ...jsonLines(capture, ended)])
  const recording = await readRecording(directory)

  expect(recording.items).toEqual([])
  expect(recording.linesRead).toBe(1)
  expect(recording.ended).toBe(false)
  expect(recording.skipped).toEqual([{ where: `${directory}/traffic.jsonl:2`, reason: 'damaged; this line and the 2 after it are ignored' }])
})

test('traffic that no table needs is read and counted but not kept', async () => {
  const xml = '<setNumberVector device="Test Mount" name="POS" state="Ok"><oneNumber name="RA">1</oneNumber></setNumberVector>'
  const traffic = Array.from({ length: 2000 }, (_, n) => ({ k: 'msg', t: 10, at: Date.parse('2030-01-01T01:00:10Z'), conn: 1, dir: 'in', n, xml }))
  const gap = { k: 'gap', t: 4, at: Date.parse('2030-01-01T01:05:00Z'), reason: 'queue full' }
  const directory = await writeRecording(join(await scratch(), 'night'), jsonLines(connected, ...traffic, capture, gap, ended))
  const recording = await readRecording(directory)

  expect(recording.items.map(line => line.k)).toEqual(['op', 'gap', 'end'])
  expect(recording.linesRead).toBe(2004)
  expect(recording.ended).toBe(true)
})

test('a line over the length limit is damage, and the lines before it are kept', async () => {
  const directory = await writeRecording(join(await scratch(), 'night'), [...jsonLines(connected, capture), 'x'.repeat(65 * 1024 * 1024), ...jsonLines(ended)])
  const recording = await readRecording(directory)

  expect(recording.items.map(line => line.k)).toEqual(['op'])
  expect(recording.skipped).toEqual([{ where: `${directory}/traffic.jsonl:3`, reason: 'damaged; this line and the 1 after it are ignored' }])
})

test('damage followed by a torn tail reports both', async () => {
  const directory = await writeRecording(join(await scratch(), 'night'), [...jsonLines(connected), 'not json', ...jsonLines(capture)])

  await writeFile(join(directory, 'traffic.jsonl'), `${JSON.stringify(connected)}\nnot json\n${JSON.stringify(capture)}\n{"k":"msg"`)

  const recording = await readRecording(directory)

  expect(recording).toMatchObject({ tornTail: true, ended: false })
  expect(recording.skipped).toHaveLength(1)
})

test('lines are streamed across chunk boundaries, with multibyte text intact', async () => {
  const path = join(await scratch(), 'lines.txt')
  const long = `é${'b'.repeat(3 * 1024 * 1024)}é`

  await writeFile(path, `first\n${long}\n\nlast`)

  const lines = []

  for await (const line of linesOf(path)) lines.push([line.number, line.text.length, line.complete])

  expect(lines).toEqual([
    [1, 5, true],
    [2, long.length, true],
    [3, 0, true],
    [4, 4, false],
  ])
})
