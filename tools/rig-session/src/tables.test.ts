import { expect, test } from 'vitest'
import type { MountSample, SavedImage, TraceSpan } from './inputs.ts'
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
    sampledAt: at(time),
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
    mountSamples: [],
  })

  expect(tables.frames[0]).toMatchObject({ span_link: 'ambiguous', span_candidates: '["first","second"]' })
  expect(tables.spans.map(row => row.span_id)).toEqual(['first', 'second'])
})
