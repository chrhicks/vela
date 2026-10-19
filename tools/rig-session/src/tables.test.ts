import { expect, test } from 'vitest'
import type { FrameRecord, MountSample, SavedImage, TraceSpan } from './inputs.ts'
import type { RecordedOperation, Recording } from './recording.ts'
import { buildTables, hourAngle } from './tables.ts'

const at = (time: string) => new Date(`2030-01-01T${time}Z`)

const window = { from: at('00:00:00'), to: at('01:00:00') }

function image(id: string, capturedAt: string): SavedImage {
  return {
    id,
    capturedAt: at(capturedAt),
    capturedAtSource: 'camera',
    receivedAt: at(capturedAt),
    exposureSeconds: 60,
    width: 100,
    height: 80,
    cameraName: 'Test camera',
    rigId: 'rig-a',
    targetId: 'target-1',
    targetName: 'Test target',
    detectedStars: 12,
    medianHfrPixels: 3.5,
    directory: `/frames/${id}`,
  }
}

function record(attempt: number, imageId: string | null, outcome: FrameRecord['outcome'] = 'saved'): FrameRecord {
  return {
    rigId: 'rig-a',
    runId: 'run-1',
    attempt,
    startedAt: at('00:10:00'),
    settledAt: at('00:11:00'),
    exposureSeconds: 60,
    outcome,
    message: outcome === 'saved' ? null : 'Cria lost the image',
    requestId: `request-${attempt}`,
    operationId: outcome === 'failed' ? null : `operation-${attempt}`,
    criaImageId: imageId === null ? null : `cria-${imageId}`,
    imageId,
    detectedStars: imageId === null ? null : 12,
    medianHfrPixels: imageId === null ? null : 3.5,
  }
}

function span(spanId: string, start: string, end: string, index: number): TraceSpan {
  return {
    traceId: `trace-${spanId}`,
    spanId,
    name: 'capture.frame',
    startedAt: at(start),
    endedAt: at(end),
    durationMs: 60000,
    statusCode: 0,
    attributesJson: '{}',
    captureFrame: { rigId: 'rig-a', index, outcome: 'saved' },
  }
}

function sample(time: string, tracking: boolean): MountSample {
  return {
    source: 'csv',
    sampledAt: at(time),
    validUntil: null,
    raHours: 23,
    decDegrees: 10.25,
    lstHours: 1,
    tracking,
    slewing: false,
    parked: false,
    pierSide: 'east',
    trackMode: 'sidereal',
  }
}

test('a frame row carries its span and mount links, a frame without either carries nulls, and the window decides what is in', () => {
  const tables = buildTables('test-night', window, {
    savedImages: [image('linked', '00:10:30'), image('alone', '00:30:00'), image('too-late', '02:00:00')],
    spans: [span('span-7', '00:10:00', '00:11:00', 7), span('after-window', '03:00:00', '03:01:00', 8)],
    frameRecords: [],
    recording: null,
    mountSamples: [sample('00:10:20', true), sample('02:00:00', true)],
  })

  expect(tables.frames.map(frame => frame.frame_id)).toEqual(['linked', 'alone'])
  expect(tables.spans.map(row => row.span_id)).toEqual(['span-7'])
  expect(tables.mount.map(row => row.sampled_at)).toEqual([at('00:10:20')])
  expect(tables.frames[0]).toEqual({
    session: 'test-night',
    frame_id: 'linked',
    captured_at: at('00:10:30'),
    captured_at_source: 'camera',
    received_at: at('00:10:30'),
    exposure_seconds: 60,
    width: 100,
    height: 80,
    camera_name: 'Test camera',
    rig_id: 'rig-a',
    target_id: 'target-1',
    target_name: 'Test target',
    detected_stars: 12,
    median_hfr_px: 3.5,
    saved_dir: '/frames/linked',
    span_id: 'span-7',
    span_link: 'inferred',
    span_candidates: null,
    run_frame_index: 7,
    mount_sampled_at: at('00:10:20'),
    mount_link: 'inferred',
    mount_candidates: null,
    mount_age_seconds: 10,
    run_id: null,
    attempt: null,
    request_id: null,
    operation_id: null,
    cria_image_id: null,
    attempt_link: null,
    attempt_candidates: null,
    operation_link: null,
    operation_candidates: null,
    blob_path: null,
    blob_link: null,
    blob_candidates: null,
  })
  expect(tables.frames[1]).toMatchObject({
    span_id: null,
    span_link: null,
    run_frame_index: null,
    mount_sampled_at: null,
    mount_link: null,
    mount_age_seconds: null,
  })
})

test('an ambiguous span link names no span and lists its candidates', () => {
  const tables = buildTables('test-night', window, {
    savedImages: [image('contested', '00:10:30')],
    spans: [span('first', '00:10:00', '00:11:00', 1), span('second', '00:10:20', '00:11:20', 2)],
    frameRecords: [],
    recording: null,
    mountSamples: [],
  })

  expect(tables.frames[0]).toMatchObject({
    span_id: null,
    span_link: 'ambiguous',
    span_candidates: '["first","second"]',
    run_frame_index: null,
  })
})

test('hour angle is sidereal time minus right ascension, wrapped into (-12, 12]', () => {
  expect(hourAngle(1, 23)).toBe(2)
  expect(hourAngle(23, 1)).toBe(-2)
  expect(hourAngle(12, 0)).toBe(12)
  expect(hourAngle(0, 12)).toBe(12)
  expect(hourAngle(13, 0)).toBe(-11)
})

test('a frame at the start of the window exports the mount sample and span it links to, so a join finds them', () => {
  const tables = buildTables('test-night', window, {
    savedImages: [image('first', '00:00:01')],
    spans: [
      { ...span('started-early', '00:00:00', '00:01:00', 4), startedAt: new Date('2029-12-31T23:59:30Z') },
      { ...span('unrelated', '00:00:00', '00:01:00', 3), startedAt: new Date('2029-12-31T22:00:00Z'), endedAt: new Date('2029-12-31T22:01:00Z') },
    ],
    frameRecords: [],
    recording: null,
    mountSamples: [
      { ...sample('00:00:00', true), sampledAt: new Date('2029-12-31T23:59:58Z') },
      { ...sample('00:00:00', true), sampledAt: new Date('2029-12-31T23:59:50Z') },
    ],
  })

  expect(tables.frames[0]).toMatchObject({ span_id: 'started-early', mount_link: 'inferred', mount_age_seconds: 3 })
  expect(tables.spans.map(row => row.span_id)).toEqual(['started-early'])
  expect(tables.mount.map(row => row.sampled_at)).toEqual([new Date('2029-12-31T23:59:58Z')])
})

test('a frame at the start of the window with an ambiguous span link exports every candidate span', () => {
  const early = (spanId: string, index: number) => ({ ...span(spanId, '00:00:00', '00:01:00', index), startedAt: new Date('2029-12-31T23:59:30Z') })

  const tables = buildTables('test-night', window, {
    savedImages: [image('contested', '00:00:10')],
    spans: [early('first', 1), early('second', 2)],
    frameRecords: [],
    recording: null,
    mountSamples: [],
  })

  expect(tables.frames[0]).toMatchObject({ span_link: 'ambiguous', span_candidates: '["first","second"]' })
  expect(tables.spans.map(row => row.span_id)).toEqual(['first', 'second'])
})

test('a frame links exactly to the attempt that saved its image, and a lost attempt is a row with no frame', () => {
  const tables = buildTables('test-night', window, {
    savedImages: [image('frame-1', '00:10:30'), image('frame-2', '00:20:30')],
    spans: [],
    frameRecords: [record(1, 'frame-1'), { ...record(2, null, 'lost'), startedAt: at('00:15:00') }, { ...record(3, 'frame-2'), startedAt: at('00:20:00') }],
    recording: null,
    mountSamples: [],
  })

  expect(tables.frames.map(frame => [frame.frame_id, frame.attempt, frame.attempt_link, frame.operation_id, frame.request_id, frame.cria_image_id])).toEqual([
    ['frame-1', 1, 'exact', 'operation-1', 'request-1', 'cria-frame-1'],
    ['frame-2', 3, 'exact', 'operation-3', 'request-3', 'cria-frame-2'],
  ])
  expect(tables.attempts.map(row => [row.attempt, row.outcome, row.frame_id, row.frame_link, row.message])).toEqual([
    [1, 'saved', 'frame-1', 'exact', null],
    [2, 'lost', null, null, 'Cria lost the image'],
    [3, 'saved', 'frame-2', 'exact', null],
  ])
})

test('a saved image with no record and a record whose image was not saved link to nothing', () => {
  const tables = buildTables('test-night', window, {
    savedImages: [image('orphan', '00:10:30')],
    spans: [],
    frameRecords: [record(1, 'never-saved', 'unsaved')],
    recording: null,
    mountSamples: [],
  })

  expect(tables.frames[0]).toMatchObject({ run_id: null, operation_id: null, attempt_link: null, attempt_candidates: null })
  expect(tables.attempts[0]).toMatchObject({ frame_id: null, frame_link: null, outcome: 'unsaved' })
})

test('two records for one image are ambiguous: the frame names neither and lists both', () => {
  const tables = buildTables('test-night', window, {
    savedImages: [image('frame-1', '00:10:30')],
    spans: [],
    frameRecords: [record(1, 'frame-1'), record(2, 'frame-1')],
    recording: null,
    mountSamples: [],
  })

  expect(tables.frames[0]).toMatchObject({ run_id: null, operation_id: null, attempt_link: 'ambiguous', attempt_candidates: '["run-1/1","run-1/2"]' })
  expect(tables.attempts.map(row => [row.frame_id, row.frame_link])).toEqual([['frame-1', 'exact'], ['frame-1', 'exact']])
})

test('an attempt that started before the window is exported when an exported frame links to it', () => {
  const tables = buildTables('test-night', window, {
    savedImages: [image('frame-1', '00:00:30')],
    spans: [],
    frameRecords: [{ ...record(1, 'frame-1'), startedAt: new Date('2029-12-31T23:59:30Z') }, { ...record(2, null, 'failed'), startedAt: new Date('2029-12-31T23:00:00Z') }],
    recording: null,
    mountSamples: [],
  })

  expect(tables.attempts.map(row => row.attempt)).toEqual([1])
})

function operation(id: string, requestId: string, acceptedAt: string): RecordedOperation {
  return {
    id,
    requestId,
    instanceId: 'instance-1',
    deviceId: 'primary',
    kind: 'capture',
    parameters: { exposureSeconds: 60 },
    acceptedAt: at(acceptedAt),
    startedAt: at(acceptedAt),
    settledAt: at('00:59:00'),
    outcome: { kind: 'confirmed', value: { image: { id: `image-${id}`, original: { bytes: 5000 } } } },
  }
}

function recordingOf(...operations: RecordedOperation[]): Recording {
  return {
    items: operations.map(op => ({ k: 'op' as const, at: op.settledAt, operation: op })),
    skipped: [],
    name: 'test-recording',
    instanceId: 'instance-1',
    startedAt: at('00:00:00'),
    devices: [{ id: 'primary', kind: 'camera', indiDevice: 'Test Camera' }],
    tornTail: false,
    ended: true,
  }
}

test('a frame and its attempt link exactly to the operation they name, and an attempt that Cria never admitted finds its request instead', () => {
  const tables = buildTables('test-night', window, {
    savedImages: [image('frame-1', '00:10:30')],
    spans: [],
    frameRecords: [record(1, 'frame-1'), { ...record(2, null, 'failed'), operationId: null, requestId: 'request-2' }, { ...record(3, null, 'lost'), operationId: 'operation-elsewhere' }],
    recording: recordingOf(operation('operation-1', 'request-1', '00:10:01'), operation('operation-2', 'request-2', '00:10:02')),
    mountSamples: [],
  })

  expect(tables.frames[0]).toMatchObject({ operation_id: 'operation-1', operation_link: 'exact', operation_candidates: null })
  expect(tables.attempts.map(row => [row.attempt, row.operation_link])).toEqual([[1, 'exact'], [2, 'exact'], [3, null]])
  expect(tables.indi_ops.map(row => [row.operation_id, row.indi_device, row.image_id, row.image_bytes, row.outcome])).toEqual([
    ['operation-1', 'Test Camera', 'image-operation-1', 5000, 'confirmed'],
    ['operation-2', 'Test Camera', 'image-operation-2', 5000, 'confirmed'],
  ])
})

test('two operations with one request id leave the request-only attempt ambiguous', () => {
  const tables = buildTables('test-night', window, {
    savedImages: [],
    spans: [],
    frameRecords: [{ ...record(1, null, 'failed'), operationId: null, requestId: 'shared' }],
    recording: recordingOf(operation('operation-a', 'shared', '00:10:01'), operation('operation-b', 'shared', '00:10:02')),
    mountSamples: [],
  })

  expect(tables.attempts[0]).toMatchObject({ operation_link: 'ambiguous', operation_candidates: '["operation-a","operation-b"]' })
})

test('an operation before the window is exported when an exported attempt links to it', () => {
  const tables = buildTables('test-night', window, {
    savedImages: [image('frame-1', '00:00:30')],
    spans: [],
    frameRecords: [{ ...record(1, 'frame-1'), startedAt: at('00:00:01') }],
    recording: recordingOf(operation('operation-1', 'request-1', '23:59:59'), operation('operation-unrelated', 'request-9', '23:00:00')),
    mountSamples: [],
  })

  expect(tables.indi_ops.map(row => row.operation_id)).toEqual(['operation-1'])
})
