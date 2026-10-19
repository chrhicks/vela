import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { readFrameRecords, readMountCsv, readSavedImages, readTraces } from './inputs.ts'

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'rig-session-inputs-'))
}

const metadata = {
  id: 'frame-1',
  subject: { targetId: 'target-1', name: 'Test target', catalog: 'T 1' },
  width: 100,
  height: 80,
  exposureSeconds: 60,
  capturedAt: '2030-01-01T00:00:01.500Z',
  receivedAt: '2030-01-01T00:01:05.000Z',
  cameraName: 'Test camera',
  capturedAtSource: 'camera',
  statistics: { detectedStars: 12, medianHfrPixels: null },
  rigId: 'rig-a',
}

test('metadata saved before the timestamp source was recorded reads as camera-reported', async () => {
  const root = await scratch()
  const { capturedAtSource: _recorded, ...legacy } = metadata

  await mkdir(join(root, 'library', 'legacy'), { recursive: true })
  await writeFile(join(root, 'library', 'legacy', 'metadata.json'), JSON.stringify(legacy))

  const { items, skipped } = await readSavedImages(root)

  expect(skipped).toEqual([])
  expect(items.map(image => image.capturedAtSource)).toEqual(['camera'])
})

test('saved images read their metadata and report the frames that cannot be read', async () => {
  const root = await scratch()

  await mkdir(join(root, 'library', 'good'), { recursive: true })
  await mkdir(join(root, 'library', 'broken'))
  await mkdir(join(root, 'library', 'empty'))
  await writeFile(join(root, 'library', 'good', 'metadata.json'), JSON.stringify(metadata))
  await writeFile(join(root, 'library', 'broken', 'metadata.json'), JSON.stringify({ ...metadata, width: 'wide' }))

  const { items, skipped } = await readSavedImages(root)

  expect(items).toEqual([
    {
      id: 'frame-1',
      capturedAt: new Date('2030-01-01T00:00:01.500Z'),
      capturedAtSource: 'camera',
      receivedAt: new Date('2030-01-01T00:01:05.000Z'),
      exposureSeconds: 60,
      width: 100,
      height: 80,
      cameraName: 'Test camera',
      rigId: 'rig-a',
      targetId: 'target-1',
      targetName: 'Test target',
      detectedStars: 12,
      medianHfrPixels: null,
      directory: join(root, 'library', 'good'),
    },
  ])
  expect(skipped.map(entry => entry.where).sort()).toEqual([join(root, 'library', 'broken'), join(root, 'library', 'empty')])
})

function spanLine(name: string, attributes: Readonly<Record<string, string | number>>) {
  return JSON.stringify({
    type: 'span',
    name,
    traceId: 'trace',
    spanId: name,
    startTime: '2030-01-01T00:00:00.000Z',
    endTime: '2030-01-01T00:01:00.000Z',
    durationMs: 60000,
    status: { code: 0 },
    attributes,
  })
}

test('trace spans keep their attributes, and capture.frame spans expose the frame they describe', async () => {
  const dir = await scratch()
  const file = join(dir, 'traces.jsonl')

  const frameAttributes = {
    'capture.rig.id': 'rig-a',
    'capture.frame.index': 3,
    'capture.frame.outcome': 'saved',
  }

  await writeFile(file, [spanLine('capture.frame', frameAttributes), spanLine('other', { a: 1 }), '{not json', ''].join('\n'))

  const { items, skipped } = await readTraces(file)

  expect(items.map(span => [span.name, span.attributesJson, span.captureFrame])).toEqual([
    ['capture.frame', JSON.stringify(frameAttributes), { rigId: 'rig-a', index: 3, outcome: 'saved' }],
    ['other', '{"a":1}', null],
  ])
  expect(skipped.map(entry => entry.where)).toEqual([`${file}:3`])
})

test('mount samples read as UTC, and a repeated time or unreadable line is reported, not kept', async () => {
  const dir = await scratch()
  const file = join(dir, 'mount.csv')

  await writeFile(
    file,
    [
      'utc,ra_h,dec_deg,tracking,slewing,parked,pier,lst_h,track_mode,avail,held,open_ops,last_op',
      '2030-01-01T00:00:00,6.5,10.25,True,False,False,east,7.5,sidereal,,False,0,capture',
      '2030-01-01T00:00:00,6.5,10.25,True,False,False,east,7.5,sidereal,,False,0,capture',
      '2030-01-01T00:00:10,6.5,10.25,maybe,False,False,east,7.5,sidereal,,False,0,capture',
      '2030-01-01T00:00:20,6.5,10.25,False,True,False,west,7.5,sidereal,,False,0,capture',
      '',
    ].join('\n'),
  )

  const { items, skipped } = await readMountCsv(file)

  expect(items.map(sample => [sample.sampledAt.toISOString(), sample.tracking, sample.slewing, sample.pierSide])).toEqual([
    ['2030-01-01T00:00:00.000Z', true, false, 'east'],
    ['2030-01-01T00:00:20.000Z', false, true, 'west'],
  ])
  expect(skipped.map(entry => entry.where)).toEqual([`${file}:3`, `${file}:4`])
})

const frameRecord = {
  version: 1,
  rigId: 'rig-a',
  runId: 'run-1',
  attempt: 1,
  startedAt: '2030-01-01T00:00:00.000Z',
  settledAt: '2030-01-01T00:01:00.000Z',
  exposureSeconds: 60,
  subject: null,
  outcome: 'saved',
  message: null,
  provenance: { requestId: 'request-1', operationId: 'operation-1', imageId: 'cria-image-1' },
  image: { id: 'frame-1', capturedAt: '2030-01-01T00:00:01.500Z', capturedAtSource: 'camera', receivedAt: '2030-01-01T00:01:00.000Z', width: 100, height: 80 },
  statistics: { detectedStars: 12, medianHfrPixels: 3.5 },
}

test('frame records read every outcome, with or without ids and an image, and skip what cannot be read', async () => {
  const dir = await scratch()
  const file = join(dir, 'frames.jsonl')
  const lost = { ...frameRecord, attempt: 2, outcome: 'lost', message: 'gone', provenance: { requestId: 'request-2', operationId: null, imageId: null }, image: null, statistics: null }
  const alpaca = { ...frameRecord, attempt: 3, provenance: null }

  await writeFile(
    file,
    [frameRecord, lost, alpaca, { ...frameRecord }, { ...frameRecord, attempt: 4, outcome: 'vanished' }].map(line => JSON.stringify(line)).join('\n') + '\n{torn',
  )

  const { items, skipped } = await readFrameRecords(file)

  expect(items.map(item => [item.attempt, item.outcome, item.requestId, item.operationId, item.criaImageId, item.imageId, item.detectedStars])).toEqual([
    [1, 'saved', 'request-1', 'operation-1', 'cria-image-1', 'frame-1', 12],
    [2, 'lost', 'request-2', null, null, null, null],
    [3, 'saved', null, null, null, 'frame-1', 12],
  ])
  expect(skipped.map(entry => entry.where)).toEqual([`${file}:4`, `${file}:5`, `${file}:6`])
  expect(skipped[0]?.reason).toBe('repeats the run and attempt of an earlier record')
})
