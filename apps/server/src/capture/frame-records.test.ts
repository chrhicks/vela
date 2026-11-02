import { describe, expect, it, vi } from 'vitest'
import { decodeLine, encodeEvent, type RigEvent } from '@vela/rig-events'
import { frameRecordsOn, frameRigId, type FrameRecord } from './frame-records.js'

const record: FrameRecord = {
  rigId: 'fra-cria',
  runId: 'run-1',
  attempt: 2,
  startedAt: '2026-10-17T03:00:00.000Z',
  settledAt: '2026-10-17T03:00:12.000Z',
  exposureSeconds: 10,
  frameType: 'light',
  subject: null,
  outcome: 'failed',
  message: 'Cria restarted',
  provenance: { requestId: 'request-1', operationId: null, imageId: null },
  image: null,
  fits: null,
  statistics: null,
}

function filed(sent: FrameRecord): RigEvent[] {
  const events: RigEvent[] = []

  frameRecordsOn({ append: event => void events.push(event) }).append(sent)

  return events
}

describe('frameRecordsOn', () => {
  it('files a failed attempt with why it failed, stamped with the moment it settled', () => {
    const [event] = filed(record)

    expect(event).toMatchObject({ kind: 'frame', rig: 'fra-cria', at: Date.parse(record.settledAt), seenAt: Date.parse(record.settledAt), body: { outcome: 'failed', message: 'Cria restarted', provenance: record.provenance, origin: 'capture-run' } })

    const again = decodeLine(encodeEvent(event!))

    expect(again.ok && again.event).toEqual(event)
  })

  it('names the saved FITS and drops what the event does not keep of the statistics', () => {
    const [event] = filed({
      ...record,
      outcome: 'saved',
      message: null,
      image: { id: '00000000-0000-4000-8000-000000000001', capturedAt: record.startedAt, capturedAtSource: 'camera', receivedAt: record.settledAt, width: 4, height: 3 },
      fits: { path: '/data/saved-images/a/b/original.fits', bytes: 2880 },
      statistics: { algorithm: { version: 3 }, detectedStars: 9, medianHfrPixels: 2.5, detections: 12 },
    })

    expect(event?.kind === 'frame' && event.body.image?.ref).toEqual({ uri: 'file:///data/saved-images/a/b/original.fits', bytes: 2880, sha256: null })
    expect(event?.kind === 'frame' && event.body.statistics).toEqual({ detectedStars: 9, medianHfrPixels: 2.5 })
  })

  it('never throws into the capture, even for a rig id the log cannot name', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => frameRecordsOn({ append() {} }).append({ ...record, rigId: 'Not A Rig' })).not.toThrow()
    expect(error).toHaveBeenCalledOnce()
    error.mockRestore()
  })
})

describe('frameRigId', () => {
  it('takes the ids a catalog holds and refuses what the run log cannot name', () => {
    expect(frameRigId('fra-cria')).toBe('fra-cria')
    expect(frameRigId('3f2a9c1e-7d44-4b0e-9a55-0c6d1b8e2f10')).toBe('3f2a9c1e-7d44-4b0e-9a55-0c6d1b8e2f10')
    expect(() => frameRigId('fra 400')).toThrow(/lowercase letters, digits and hyphens/)
  })
})
