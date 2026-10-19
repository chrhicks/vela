import { mkdir, mkdtemp, readdir, readFile, readlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { expect, test } from 'vitest'
import { publishPackage } from './package.ts'
import { openPackage } from './query.ts'
import { Secrets } from './sanitize.ts'
import type { Tables } from './schema.ts'
import { buildSession } from './session.ts'

const window = { from: new Date('2030-01-01T00:00:00Z'), to: new Date('2030-01-01T06:00:00Z') }

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'rig-session-package-'))
}

/** Three frames, the last of them dark, with a mount that stops tracking after the second. */
async function syntheticNight() {
  const dir = await scratch()
  const savedImagesDir = join(dir, 'saved-images')
  const tracesFile = join(dir, 'traces.jsonl')
  const mountCsvFile = join(dir, 'mount.csv')
  const stars = [120, 80, 0]

  for (const [index, count] of stars.entries()) {
    const frameDir = join(savedImagesDir, 'library', `frame-${index}`)
    const minute = `0${index + 1}`

    await mkdir(frameDir, { recursive: true })
    await writeFile(
      join(frameDir, 'metadata.json'),
      JSON.stringify({
        id: `frame-${index}`,
        width: 100,
        height: 80,
        exposureSeconds: 50,
        capturedAt: `2030-01-01T01:${minute}:00.000Z`,
        receivedAt: `2030-01-01T01:${minute}:55.000Z`,
        cameraName: 'Test camera',
        capturedAtSource: 'camera',
        statistics: { detectedStars: count, medianHfrPixels: count === 0 ? null : 3 },
        rigId: 'rig-a',
      }),
    )
  }

  const spans = [1, 2, 3].map(minute =>
    JSON.stringify({
      type: 'span',
      name: 'capture.frame',
      traceId: `trace-${minute}`,
      spanId: `span-${minute}`,
      startTime: `2030-01-01T01:0${minute}:00.000Z`,
      endTime: `2030-01-01T01:0${minute}:55.000Z`,
      durationMs: 55000,
      status: { code: 0 },
      attributes: { 'capture.rig.id': 'rig-a', 'capture.frame.index': minute, 'capture.frame.outcome': 'saved' },
    }),
  )

  await writeFile(tracesFile, `${spans.join('\n')}\n`)
  await writeFile(
    mountCsvFile,
    [
      'utc,ra_h,dec_deg,tracking,slewing,parked,pier,lst_h,track_mode,avail,held,open_ops,last_op',
      '2030-01-01T01:00:58,6.5,10.25,True,False,False,east,7.5,sidereal,,False,0,capture',
      '2030-01-01T01:01:58,6.5,10.25,True,False,False,east,7.5,sidereal,,False,0,capture',
      '2030-01-01T01:02:58,6.5,10.25,False,False,False,east,7.5,sidereal,,False,0,capture',
      '',
    ].join('\n'),
  )

  const frameRecordsFile = join(dir, 'frames.jsonl')

  await writeFile(
    frameRecordsFile,
    `${stars
      .map((_, index) =>
        JSON.stringify({
          version: 1,
          rigId: 'rig-a',
          runId: 'run-1',
          attempt: index + 1,
          startedAt: `2030-01-01T01:0${index + 1}:00.000Z`,
          settledAt: `2030-01-01T01:0${index + 1}:56.000Z`,
          exposureSeconds: 50,
          subject: null,
          outcome: 'saved',
          message: null,
          provenance: { requestId: `request-${index}`, operationId: `operation-${index}`, imageId: `cria-image-${index}` },
          image: { id: `frame-${index}`, capturedAt: '2030-01-01T01:00:00.000Z', capturedAtSource: 'camera', receivedAt: '2030-01-01T01:00:55.000Z', width: 100, height: 80 },
          statistics: null,
        }),
      )
      .join('\n')}\n`,
  )

  return { dir, savedImagesDir, tracesFile, mountCsvFile, frameRecordsFile }
}

async function build(night: Awaited<ReturnType<typeof syntheticNight>>, root: string) {
  return buildSession({
    name: 'test-night',
    window,
    root,
    savedImagesDir: night.savedImagesDir,
    tracesFile: night.tracesFile,
    mountCsvFile: night.mountCsvFile,
    frameRecordsFile: night.frameRecordsFile,
  })
}

const starsAndTracking = `
  SELECT f.frame_id, f.detected_stars, m.tracking
  FROM frames f LEFT JOIN mount m ON m.sampled_at = f.mount_sampled_at
  ORDER BY f.captured_at`

test('a query joins stars per frame to whether the mount was tracking', async () => {
  const night = await syntheticNight()
  const root = join(night.dir, 'out')

  await build(night, root)

  const session = await openPackage(join(root, 'package'))

  expect(await session.rows(starsAndTracking)).toEqual([
    { frame_id: 'frame-0', detected_stars: '120', tracking: true },
    { frame_id: 'frame-1', detected_stars: '80', tracking: true },
    { frame_id: 'frame-2', detected_stars: '0', tracking: false },
  ])
  session.close()
})

test('session.json lists the inputs it found and the ones it lacks', async () => {
  const night = await syntheticNight()
  const root = join(night.dir, 'out')

  await build(night, root)

  const summary = JSON.parse(await readFile(join(root, 'package', 'session.json'), 'utf8'))

  expect(summary.inputs.map((input: { input: string; status: string }) => [input.input, input.status])).toEqual([
    ['saved-images', 'found'],
    ['traces', 'found'],
    ['mount-csv', 'found'],
    ['indi-recording', 'missing'],
    ['frame-records', 'found'],
  ])
  expect(summary.rows).toEqual({ frames: 3, attempts: 3, mount: 3, spans: 3 })
  expect(summary.links.frame_to_span).toEqual({ exact: 0, inferred: 3, ambiguous: 0, none: 0 })
  expect(summary.links.frame_to_attempt).toEqual({ exact: 3, inferred: 0, ambiguous: 0, none: 0 })
})

test('rebuilding the same inputs gives the same rows in the same files', async () => {
  const night = await syntheticNight()
  const root = join(night.dir, 'out')

  const first = await build(night, root)
  const firstFrames = await readFile(join(first, 'frames.parquet'))
  const firstMount = await readFile(join(first, 'mount.parquet'))

  const second = await build(night, root)

  expect(second).not.toBe(first)
  expect(await readFile(join(second, 'frames.parquet'))).toEqual(firstFrames)
  expect(await readFile(join(second, 'mount.parquet'))).toEqual(firstMount)
})

test('a build that fails part way leaves the previous package readable, and the next build clears its debris', async () => {
  const night = await syntheticNight()
  const root = join(night.dir, 'out')
  const published = await build(night, root)

  const unreadableSpan: Tables = {
    frames: [],
    attempts: [],
    mount: [],
    spans: [
      {
        session: 'test-night',
        trace_id: 'trace',
        span_id: 'span',
        name: 'capture.frame',
        started_at: new Date(Number.NaN),
        ended_at: new Date(0),
        duration_ms: 0,
        status_code: 0,
        attributes: '{}',
      },
    ],
  }

  await expect(publishPackage(root, unreadableSpan, {}, new Secrets())).rejects.toThrow()

  expect(await readlink(join(root, 'package'))).toBe(join('builds', basename(published)))

  const session = await openPackage(join(root, 'package'))

  expect(await session.rows(starsAndTracking)).toHaveLength(3)
  session.close()
  expect((await readdir(join(root, 'builds'))).filter(entry => entry.startsWith('.building-'))).toHaveLength(1)

  await build(night, root)

  expect(await readdir(join(root, 'builds'))).toHaveLength(1)
})

test('a night with no frame records lists them as missing with what that costs, and its frames carry no ids', async () => {
  const night = await syntheticNight()
  const root = join(night.dir, 'out')

  await buildSession({ name: 'test-night', window, root, savedImagesDir: night.savedImagesDir, tracesFile: null, mountCsvFile: null, frameRecordsFile: null })

  const summary = JSON.parse(await readFile(join(root, 'package', 'session.json'), 'utf8'))
  const session = await openPackage(join(root, 'package'))

  expect(summary.inputs.find((input: { input: string }) => input.input === 'frame-records')).toEqual({
    input: 'frame-records',
    status: 'missing',
    effect: 'Frames carry no request or operation ids, so none links exactly to a Cria operation.',
  })
  expect(await session.rows('SELECT operation_id, attempt_link FROM frames ORDER BY frame_id')).toEqual(
    [0, 1, 2].map(() => ({ operation_id: null, attempt_link: null })),
  )
  session.close()
})

test('a query names the Cria operation behind each saved frame', async () => {
  const night = await syntheticNight()
  const root = join(night.dir, 'out')

  await build(night, root)

  const session = await openPackage(join(root, 'package'))

  expect(await session.rows('SELECT f.frame_id, a.operation_id, f.attempt_link FROM frames f JOIN attempts a ON a.frame_id = f.frame_id ORDER BY f.frame_id')).toEqual([
    { frame_id: 'frame-0', operation_id: 'operation-0', attempt_link: 'exact' },
    { frame_id: 'frame-1', operation_id: 'operation-1', attempt_link: 'exact' },
    { frame_id: 'frame-2', operation_id: 'operation-2', attempt_link: 'exact' },
  ])
  session.close()
})

test('an attempt message that names the site or a serial port is redacted in the package', async () => {
  const night = await syntheticNight()
  const root = join(night.dir, 'out')

  const message = 'adapter failed: open /dev/serial/by-id/usb-Test_0001 and set LAT=12.5 LONG=345.25'
  const records = (await readFile(night.frameRecordsFile, 'utf8')).trim().split('\n')
  const failed = { ...JSON.parse(records[0] ?? ''), outcome: 'failed', message, image: null, statistics: null }

  await writeFile(night.frameRecordsFile, `${[JSON.stringify(failed), ...records.slice(1)].join('\n')}\n`)
  await build(night, root)

  const session = await openPackage(join(root, 'package'))

  expect(await session.rows("SELECT message FROM attempts WHERE outcome = 'failed'")).toEqual([
    { message: 'adapter failed: open [redacted] and set LAT=[redacted] LONG=[redacted]' },
  ])
  session.close()
})
