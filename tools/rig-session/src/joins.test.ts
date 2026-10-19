import { expect, test } from 'vitest'
import type { MountSample, SavedImage, TraceSpan } from './inputs.ts'
import { linkFrameToSpan, linkMountAsOf } from './joins.ts'

const at = (time: string) => new Date(`2030-01-01T${time}Z`)

function image(capturedAt: string, rigId = 'rig-a'): SavedImage {
  return {
    id: `image-${capturedAt}`,
    capturedAt: at(capturedAt),
    capturedAtSource: 'camera',
    receivedAt: at(capturedAt),
    exposureSeconds: 60,
    width: 10,
    height: 10,
    cameraName: 'Test camera',
    rigId,
    targetId: null,
    targetName: null,
    detectedStars: null,
    medianHfrPixels: null,
    directory: '/nowhere',
  }
}

function frameSpan(spanId: string, start: string, end: string, outcome = 'saved', rigId = 'rig-a'): TraceSpan {
  return {
    traceId: `trace-${spanId}`,
    spanId,
    name: 'capture.frame',
    startedAt: at(start),
    endedAt: at(end),
    durationMs: 0,
    statusCode: 0,
    attributesJson: '{}',
    captureFrame: { rigId, index: 1, outcome },
  }
}

function sample(time: string): MountSample {
  return {
    sampledAt: at(time),
    raHours: 6.5,
    decDegrees: 10.25,
    lstHours: 7,
    tracking: true,
    slewing: false,
    parked: false,
    pierSide: 'east',
    trackMode: 'sidereal',
  }
}

test('a frame links to the one span of its rig that was running at capture, inferred from time', () => {
  const spans = [frameSpan('before', '00:00:00', '00:01:00'), frameSpan('during', '00:01:00.100', '00:02:00')]

  const link = linkFrameToSpan(image('00:01:30'), spans)

  expect(link).toEqual({ kind: 'inferred', target: spans[1] })
})

test('a frame with no span that was running, or only another rig or an unsaved outcome, stays unlinked', () => {
  const spans = [
    frameSpan('other-rig', '00:00:00', '00:02:00', 'saved', 'rig-b'),
    frameSpan('lost', '00:00:00', '00:02:00', 'lost'),
    frameSpan('later', '00:05:00', '00:06:00'),
  ]

  expect(linkFrameToSpan(image('00:01:00'), spans)).toBeNull()
})

test('overlapping spans leave the frame ambiguous with both as candidates', () => {
  const spans = [frameSpan('one', '00:00:00', '00:02:00'), frameSpan('two', '00:01:00', '00:03:00')]

  const link = linkFrameToSpan(image('00:01:30'), spans)

  expect(link).toEqual({ kind: 'ambiguous', candidates: spans })
})

test('the mount sample in force is the latest one not after the frame, with its age', () => {
  const samples = [sample('00:00:00'), sample('00:00:10'), sample('00:00:20')]

  const link = linkMountAsOf(at('00:00:17.500'), samples, 30)

  expect(link).toEqual({ link: { kind: 'inferred', target: at('00:00:10') }, ageSeconds: 7.5 })
})

test('a mount sample older than the freshness limit, or none before the frame, gives no link', () => {
  const samples = [sample('00:01:00')]

  expect(linkMountAsOf(at('00:01:31'), samples, 30)).toBeNull()
  expect(linkMountAsOf(at('00:00:59'), samples, 30)).toBeNull()
})
