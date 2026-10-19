import { mkdir, mkdtemp, readdir, readFile, readlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { expect, test } from 'vitest'
import { publishPackage } from './package.ts'
import { openPackage } from './query.ts'
import type { Tables } from './schema.ts'
import { jsonLines, msgLine, opLine, writeRecording } from './recording-fixture.ts'
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

  const recordingDir = await writeRecording(join(dir, 'recording'), jsonLines(
    ...stars.map((_, index) => opLine({ id: `operation-${index}`, requestId: `request-${index}`, acceptedAt: `2030-01-01T01:0${index + 1}:00Z`, settledAt: `2030-01-01T01:0${index + 1}:55Z` })),
    opLine({
      id: 'connect',
      deviceId: 'mount',
      kind: 'device-connect',
      acceptedAt: '2030-01-01T00:59:10Z',
      settledAt: '2030-01-01T00:59:11Z',
      parameters: { connected: true },
      outcome: { kind: 'confirmed', value: { values: { setup: 'sent GEOGRAPHIC_COORD LAT=12.5 LONG=345.25 ELEV=0 on /dev/serial/by-id/usb-Test_0001' }, image: null } },
    }),
    opLine({ id: 'refused', kind: 'capture', acceptedAt: '2030-01-01T01:04:00Z', settledAt: '2030-01-01T01:04:01Z', outcome: { kind: 'failed', reason: 'invalid', message: 'needs a mono frame on /dev/ttyUSB0' } }),
    msgLine(0, '2030-01-01T00:59:10Z', 'out', '<newNumberVector device="Test Mount" name="GEOGRAPHIC_COORD"><oneNumber name="LAT">12.5</oneNumber><oneNumber name="LONG">345.25</oneNumber></newNumberVector>'),
    msgLine(0, '2030-01-01T00:59:11Z', 'in', '<defTextVector device="Test Mount" name="DEVICE_PORT" state="Ok"><defText name="PORT">/dev/serial/by-id/usb-Test_0001</defText></defTextVector>'),
    msgLine(1, '2030-01-01T00:59:12Z', 'in', '<defNumberVector device="Test Camera" name="CCD_EXPOSURE" state="Idle"><defNumber name="CCD_EXPOSURE_VALUE">0</defNumber></defNumberVector>'),
    msgLine(0, '2030-01-01T01:01:01Z', 'out', '<newNumberVector device="Test Camera" name="CCD_EXPOSURE"><oneNumber name="CCD_EXPOSURE_VALUE">50</oneNumber></newNumberVector>'),
    msgLine(2, '2030-01-01T01:01:02Z', 'in', '<setNumberVector device="Test Camera" name="CCD_EXPOSURE" state="Busy"><oneNumber name="CCD_EXPOSURE_VALUE">50</oneNumber></setNumberVector>'),
    msgLine(3, '2030-01-01T01:01:03Z', 'in', '<setNumberVector device="Test Camera" name="CCD_EXPOSURE" state="Busy"><oneNumber name="CCD_EXPOSURE_VALUE">50</oneNumber></setNumberVector>'),
    msgLine(4, '2030-01-01T01:01:30Z', 'in', '<message device="Test Camera" timestamp="2030-01-01T01:01:30" message="[ERROR] Cooler fault at LAT=12.5 on /dev/ttyUSB0"/>'),
    ...[
      ['01:01:54', 5],
      ['01:02:40', 6],
      ['01:02:50', 7],
    ].map(([time, n]) =>
      msgLine(Number(n), `2030-01-01T${time}Z`, 'in', `<setBLOBVector device="Test Camera" name="CCD1" state="Ok"><oneBLOB name="CCD1" size="5100" format=".fits" len="5100" ref="blobs/1-${n}-0.blob"/></setBLOBVector>`, [`blobs/1-${n}-0.blob`]),
    ),
    { k: 'end', t: 1, at: Date.parse('2030-01-01T01:10:00Z') },
  ))

  const journalFile = join(dir, 'cria-journal.jsonl')
  const origin = 'http://cria.example.test:4319'

  await writeFile(
    journalFile,
    [
      ...stars.flatMap((_, index) => [
        {
          kind: 'exchange', at: Date.parse(`2030-01-01T01:0${index + 1}:00Z`), ms: 12, method: 'POST', route: '/v2/operations', status: 202,
          command: { requestId: `request-${index}`, deviceId: 'primary', kind: 'capture', parameters: { exposureSeconds: 50 } },
          reply: { kind: 'answered', body: { id: `operation-${index}`, requestId: `request-${index}` } },
        },
        { kind: 'image', at: Date.parse(`2030-01-01T01:0${index + 1}:56Z`), imageId: `cria-image-${index}`, operationId: `operation-${index}`, bytes: 5000, sha256: index === 1 ? 'other' : `sha-operation-${index}`, verdict: index === 1 ? 'damaged' : 'intact' },
      ]),
      { kind: 'exchange', at: Date.parse('2030-01-01T01:04:00Z'), ms: 3, method: 'POST', route: '/v2/operations', status: 409, command: { requestId: 'request-unrecorded', deviceId: 'primary', kind: 'capture', parameters: { exposureSeconds: 50, site: { latitude: 12.5 } } }, reply: { kind: 'refused', code: 'busy', message: 'camera busy on /dev/ttyUSB0' } },
      { kind: 'exchange', at: Date.parse('2030-01-01T01:02:30Z'), ms: 4, method: 'POST', route: '/v2/operations/operation-1/stop', status: 202, command: null, reply: { kind: 'answered', body: {} } },
      {
        kind: 'state', at: Date.parse('2030-01-01T01:02:30.500Z'), generatedAt: Date.parse('2030-01-01T01:02:30Z'), sequence: 7, instanceId: 'instance-1', commandsEnabled: true, baseline: true, removed: [],
        changed: {
          'device/primary/readings.activity': { status: 'fresh', value: 'exposing', observedAt: 1 },
          'operation/operation-1': { id: 'operation-1', state: 'settled', outcome: { kind: 'confirmed', value: { values: { setup: 'sent GEOGRAPHIC_COORD LAT=12.5 LONG=345.25' } } } },
          'operation/operation-elsewhere': { id: 'operation-elsewhere', state: 'running' },
        },
      },
      { kind: 'state', at: Date.parse('2030-01-01T01:02:40Z'), generatedAt: Date.parse('2030-01-01T01:02:39Z'), sequence: 8, instanceId: 'instance-1', commandsEnabled: true, baseline: false, changed: {}, removed: ['device/old/availability'] },
      { kind: 'stream', at: Date.parse('2030-01-01T01:02:30Z'), event: 'opened', message: null },
      { kind: 'stream', at: Date.parse('2030-01-01T01:05:00Z'), event: 'ended', message: 'reset on /dev/ttyUSB0' },
    ]
      .map(line => `${JSON.stringify({ ...line, origin })}\n`)
      .join(''),
  )

  return { dir, savedImagesDir, tracesFile, mountCsvFile, frameRecordsFile, recordingDir, journalFile }
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
    recordingDir: night.recordingDir,
    journalFile: night.journalFile,
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
    ['indi-recording', 'found'],
    ['frame-records', 'found'],
    ['cria-journal', 'found'],
  ])
  expect(summary.rows).toEqual({ frames: 3, attempts: 3, indi_ops: 5, indi_events: 9, indi_images: 3, cria_requests: 5, cria_image_checks: 3, cria_state_changes: 4, cria_stream: 2, mount: 3, spans: 3 })
  expect(summary.links.frame_to_span).toEqual({ exact: 0, inferred: 3, ambiguous: 0, none: 0 })
  expect(summary.links.frame_to_attempt).toEqual({ exact: 3, inferred: 0, ambiguous: 0, none: 0 })
  expect(summary.links.request_to_attempt).toEqual({ exact: 3, inferred: 0, ambiguous: 0, none: 2 })
  expect(summary.links.image_check_to_attempt).toEqual({ exact: 3, inferred: 0, ambiguous: 0, none: 0 })
  expect(summary.links.frame_to_blob).toEqual({ exact: 0, inferred: 1, ambiguous: 1, none: 1 })
  expect(summary.links.frame_to_operation).toEqual({ exact: 3, inferred: 0, ambiguous: 0, none: 0 })
  expect(summary.recording).toMatchObject({ name: 'recording', instanceId: 'instance-1', ended: true, tornTail: false, gaps: 0 })
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
    indi_ops: [],
    indi_events: [],
    indi_images: [],
    cria_requests: [],
    cria_image_checks: [],
    cria_state_changes: [],
    cria_stream: [],
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

  await expect(publishPackage(root, unreadableSpan, '{}')).rejects.toThrow()

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

  await buildSession({ name: 'test-night', window, root, savedImagesDir: night.savedImagesDir, tracesFile: null, mountCsvFile: null, frameRecordsFile: null, recordingDir: null, journalFile: null })

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

test('a query lists the operations of the recording around each frame and joins a frame to its operation', async () => {
  const night = await syntheticNight()
  const root = join(night.dir, 'out')

  await build(night, root)

  const session = await openPackage(join(root, 'package'))

  expect(await session.rows('SELECT f.frame_id, f.operation_link, o.kind, o.outcome, o.image_id FROM frames f JOIN indi_ops o ON o.operation_id = f.operation_id ORDER BY f.frame_id')).toEqual(
    [0, 1, 2].map(index => ({ frame_id: `frame-${index}`, operation_link: 'exact', kind: 'capture', outcome: 'confirmed', image_id: `image-operation-${index}` })),
  )
  expect(await session.rows("SELECT operation_id, outcome, outcome_reason, outcome_message FROM indi_ops WHERE outcome = 'failed'")).toEqual([
    { operation_id: 'refused', outcome: 'failed', outcome_reason: 'invalid', outcome_message: 'needs a mono frame on [redacted]' },
  ])
  session.close()
})

test('no cell of the package holds the site or a serial path that the recording carried', async () => {
  const night = await syntheticNight()
  const root = join(night.dir, 'out')

  await build(night, root)

  const session = await openPackage(join(root, 'package'))
  const cells = JSON.stringify(await session.rows('SELECT * FROM indi_ops'))

  expect(cells).not.toMatch(/12\.5|345\.25|serial|ttyUSB|Test_0001/)
  expect(cells).toContain('connect')
  session.close()
})

test('a query lists the writes and errors during a frame\'s exposure with the operation they belong to', async () => {
  const night = await syntheticNight()
  const root = join(night.dir, 'out')

  await build(night, root)

  const session = await openPackage(join(root, 'package'))

  expect(
    await session.rows(`
      SELECT e.kind, e.direction, e.property, e.state, e.operation_id, e.operation_link
      FROM frames f JOIN indi_events e ON e.device = 'Test Camera' AND e.at BETWEEN f.captured_at AND f.captured_at + f.exposure_seconds * INTERVAL 1 SECOND + INTERVAL 5 SECOND
      WHERE f.frame_id = 'frame-0' ORDER BY e.at`),
  ).toEqual([
    { kind: 'write', direction: 'out', property: 'CCD_EXPOSURE', state: null, operation_id: 'operation-0', operation_link: 'inferred' },
    { kind: 'update', direction: 'in', property: 'CCD_EXPOSURE', state: 'Busy', operation_id: 'operation-0', operation_link: 'inferred' },
    { kind: 'message', direction: 'in', property: null, state: null, operation_id: 'operation-0', operation_link: 'inferred' },
    { kind: 'update', direction: 'in', property: 'CCD1', state: 'Ok', operation_id: 'operation-0', operation_link: 'inferred' },
  ])
  session.close()
})

test('no event holds the site, a serial path or the values of the properties that name them', async () => {
  const night = await syntheticNight()
  const root = join(night.dir, 'out')

  await build(night, root)

  const session = await openPackage(join(root, 'package'))
  const cells = JSON.stringify(await session.rows('SELECT * FROM indi_events'))

  expect(cells).not.toMatch(/12\.5|345\.25|serial|ttyUSB|Test_0001/)
  expect(await session.rows("SELECT property, values FROM indi_events WHERE property IN ('GEOGRAPHIC_COORD', 'DEVICE_PORT') ORDER BY property")).toEqual([
    { property: 'DEVICE_PORT', values: '{"*":"[redacted]"}' },
    { property: 'GEOGRAPHIC_COORD', values: '{"*":"[redacted]"}' },
  ])
  session.close()
})

test('a query finds the camera image of each frame: one image in the operation window is inferred, two are ambiguous, none is null', async () => {
  const night = await syntheticNight()
  const root = join(night.dir, 'out')

  await build(night, root)

  const session = await openPackage(join(root, 'package'))

  expect(await session.rows('SELECT frame_id, blob_path, blob_link, blob_candidates FROM frames ORDER BY frame_id')).toEqual([
    { frame_id: 'frame-0', blob_path: 'blobs/1-5-0.blob', blob_link: 'inferred', blob_candidates: null },
    { frame_id: 'frame-1', blob_path: null, blob_link: 'ambiguous', blob_candidates: '["blobs/1-6-0.blob","blobs/1-7-0.blob"]' },
    { frame_id: 'frame-2', blob_path: null, blob_link: null, blob_candidates: null },
  ])
  expect(await session.rows('SELECT blob_path, blob_bytes, operation_id, operation_link, image_id, image_bytes FROM indi_images ORDER BY "at"')).toEqual([
    { blob_path: 'blobs/1-5-0.blob', blob_bytes: '5100', operation_id: 'operation-0', operation_link: 'inferred', image_id: 'image-operation-0', image_bytes: '5000' },
    { blob_path: 'blobs/1-6-0.blob', blob_bytes: '5100', operation_id: 'operation-1', operation_link: 'inferred', image_id: 'image-operation-1', image_bytes: '5000' },
    { blob_path: 'blobs/1-7-0.blob', blob_bytes: '5100', operation_id: 'operation-1', operation_link: 'inferred', image_id: 'image-operation-1', image_bytes: '5000' },
  ])
  session.close()
})

test('a recording alone fills the mount table, and a frame links to the latest reading with its age', async () => {
  const night = await syntheticNight()
  const root = join(night.dir, 'out')

  const field = (kind: 'def' | 'set', type: 'Number' | 'Switch', name: string, state: string, elements: Record<string, string>) =>
    `<${kind}${type}Vector device="Test Mount" name="${name}" state="${state}">${Object.entries(elements).map(([element, value]) => `<${kind === 'def' ? 'def' : 'one'}${type} name="${element}">${value}</${kind === 'def' ? 'def' : 'one'}${type}>`).join('')}</${kind}${type}Vector>`

  const recordingDir = await writeRecording(
    join(night.dir, 'mount-recording'),
    jsonLines(
      msgLine(0, '2030-01-01T00:59:12Z', 'in', field('def', 'Number', 'GEOGRAPHIC_COORD', 'Ok', { LAT: '12.5', LONG: '15' })),
      msgLine(1, '2030-01-01T00:59:13Z', 'in', field('def', 'Number', 'EQUATORIAL_EOD_COORD', 'Ok', { RA: '6.5', DEC: '10.25' })),
      msgLine(2, '2030-01-01T00:59:14Z', 'in', field('def', 'Switch', 'TELESCOPE_TRACK_STATE', 'Ok', { TRACK_ON: 'On', TRACK_OFF: 'Off' })),
      msgLine(3, '2030-01-01T01:00:56Z', 'in', field('set', 'Number', 'EQUATORIAL_EOD_COORD', 'Busy', { RA: '6.6' })),
      msgLine(4, '2030-01-01T01:02:00Z', 'in', field('set', 'Switch', 'TELESCOPE_TRACK_STATE', 'Ok', { TRACK_ON: 'Off', TRACK_OFF: 'On' })),
    ),
  )

  await buildSession({ name: 'test-night', window, root, savedImagesDir: night.savedImagesDir, tracesFile: null, mountCsvFile: null, frameRecordsFile: null, recordingDir, journalFile: null })

  const session = await openPackage(join(root, 'package'))

  expect(await session.rows('SELECT source, tracking, slewing FROM mount ORDER BY sampled_at')).toEqual([
    { source: 'indi', tracking: null, slewing: false },
    { source: 'indi', tracking: true, slewing: false },
    { source: 'indi', tracking: true, slewing: true },
    { source: 'indi', tracking: false, slewing: true },
  ])
  expect(await session.rows('SELECT f.frame_id, f.mount_link, f.mount_age_seconds, m.tracking, m.hour_angle_hours IS NOT NULL AS has_hour_angle FROM frames f LEFT JOIN mount m ON m.sampled_at = f.mount_sampled_at ORDER BY f.frame_id')).toEqual([
    { frame_id: 'frame-0', mount_link: 'inferred', mount_age_seconds: 4, tracking: true, has_hour_angle: true },
    { frame_id: 'frame-1', mount_link: 'inferred', mount_age_seconds: 0, tracking: false, has_hour_angle: true },
    { frame_id: 'frame-2', mount_link: 'inferred', mount_age_seconds: 60, tracking: false, has_hour_angle: true },
  ])
  session.close()
})

test('a query follows a frame to the request Vela sent for it, and to the check of the image it fetched', async () => {
  const night = await syntheticNight()
  const root = join(night.dir, 'out')

  await build(night, root)

  const session = await openPackage(join(root, 'package'))

  expect(
    await session.rows(`
      SELECT f.frame_id, r.reply_kind, r.operation_id, r.operation_link, r.attempt_link, c.verdict, c.sha_matches_operation, c.attempt_link AS check_link
      FROM frames f
      JOIN cria_requests r ON r.run_id = f.run_id AND r.attempt = f.attempt
      JOIN cria_image_checks c ON c.run_id = f.run_id AND c.attempt = f.attempt
      ORDER BY f.frame_id`),
  ).toEqual([
    { frame_id: 'frame-0', reply_kind: 'answered', operation_id: 'operation-0', operation_link: 'exact', attempt_link: 'exact', verdict: 'intact', sha_matches_operation: true, check_link: 'exact' },
    { frame_id: 'frame-1', reply_kind: 'answered', operation_id: 'operation-1', operation_link: 'exact', attempt_link: 'exact', verdict: 'damaged', sha_matches_operation: false, check_link: 'exact' },
    { frame_id: 'frame-2', reply_kind: 'answered', operation_id: 'operation-2', operation_link: 'exact', attempt_link: 'exact', verdict: 'intact', sha_matches_operation: true, check_link: 'exact' },
  ])
  expect(await session.rows("SELECT request_id, reply_kind, reply_code, reply_message, attempt_link, operation_link FROM cria_requests WHERE reply_kind = 'refused'")).toEqual([
    { request_id: 'request-unrecorded', reply_kind: 'refused', reply_code: 'busy', reply_message: 'camera busy on [redacted]', attempt_link: null, operation_link: null },
  ])
  expect(await session.rows("SELECT operation_id, operation_link, request_id FROM cria_requests WHERE route LIKE '%/stop'")).toEqual([{ operation_id: 'operation-1', operation_link: 'exact', request_id: null }])
  session.close()
})

test('no cell of the journal tables holds the origin, the site or a serial path', async () => {
  const night = await syntheticNight()
  const root = join(night.dir, 'out')

  await build(night, root)

  const session = await openPackage(join(root, 'package'))
  const cells = JSON.stringify([...(await session.rows('SELECT * FROM cria_requests')), ...(await session.rows('SELECT * FROM cria_image_checks'))])

  expect(cells).not.toMatch(/example\.test|12\.5|ttyUSB/)
  session.close()
})

test('a query lists what Cria reported while a frame was exposing, with the operation cell linked and no site in it', async () => {
  const night = await syntheticNight()
  const root = join(night.dir, 'out')

  await build(night, root)

  const session = await openPackage(join(root, 'package'))

  expect(await session.rows('SELECT cell, device_id, operation_id, operation_link, removed, baseline, sequence FROM cria_state_changes ORDER BY sequence, cell')).toEqual([
    { cell: 'device/primary/readings.activity', device_id: 'primary', operation_id: null, operation_link: null, removed: false, baseline: true, sequence: '7' },
    { cell: 'operation/operation-1', device_id: null, operation_id: 'operation-1', operation_link: 'exact', removed: false, baseline: true, sequence: '7' },
    { cell: 'operation/operation-elsewhere', device_id: null, operation_id: 'operation-elsewhere', operation_link: null, removed: false, baseline: true, sequence: '7' },
    { cell: 'device/old/availability', device_id: 'old', operation_id: null, operation_link: null, removed: true, baseline: false, sequence: '8' },
  ])
  expect(await session.rows("SELECT value FROM cria_state_changes WHERE cell = 'operation/operation-1'")).toEqual([
    { value: '{"id":"operation-1","state":"settled","outcome":{"kind":"confirmed"}}' },
  ])
  expect(await session.rows('SELECT event, message FROM cria_stream ORDER BY "at"')).toEqual([
    { event: 'opened', message: null },
    { event: 'ended', message: 'reset on [redacted]' },
  ])
  session.close()
})
