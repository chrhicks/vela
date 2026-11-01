import { Schema } from 'effect'
import { epochMs, ImageId, rigId, seal, sourceId, type Draft, type Envelope, type RigEvent } from '@vela/rig-events'
import { mountState } from '@vela/rig-testing'

const stamp = (at: number) => ({ rig: rigId('test-rig'), source: sourceId('test:samples'), at: epochMs(at), seenAt: epochMs(at + 5) })

const imageId = Schema.decodeSync(ImageId)('33333333-3333-4333-8333-333333333333')

export function stateDraft(sequence: number): Draft<Envelope<'cria.state'>> {
  const at = 1_792_000_000_000 + sequence * 1000

  return {
    ...stamp(at),
    kind: 'cria.state',
    body: { origin: 'http://cria.test', freshness: 'qualified', state: mountState({ sequence, mount: { at, raHours: 5.5, decDegrees: -5.4 } }) },
  }
}

export function sampleEvents(): RigEvent[] {
  const at = 1_792_000_100_000

  return [
    seal(stateDraft(7)),
    seal({
      ...stamp(at),
      kind: 'cria.exchange',
      body: {
        origin: 'http://cria.test',
        ms: 12,
        method: 'POST',
        route: '/v2/operations',
        status: 202,
        command: { requestId: 'r-1', deviceId: 'mount', kind: 'slew', parameters: { raHours: 1, decDegrees: 2 } },
        reply: { kind: 'answered', body: { id: 'op' } },
      },
    }),
    seal({ ...stamp(at), kind: 'cria.image', body: { origin: 'http://cria.test', imageId: 'i', operationId: 'o', bytes: 10, sha256: 'a'.repeat(64), verdict: 'intact' } }),
    seal({ ...stamp(at), kind: 'cria.stream', body: { origin: 'http://cria.test', event: 'opened', message: null } }),
    seal({
      ...stamp(at),
      kind: 'frame',
      body: {
        runId: 'run-1',
        attempt: 3,
        startedAt: '2026-10-26T20:00:00.000Z',
        settledAt: '2026-10-26T20:00:31.000Z',
        exposureSeconds: 30,
        frameType: 'light',
        subject: { targetId: 't', name: 'Target', catalog: 'NGC' },
        outcome: 'saved',
        image: {
          id: imageId,
          capturedAt: '2026-10-26T20:00:00.500Z',
          capturedAtSource: 'camera',
          receivedAt: '2026-10-26T20:00:31.000Z',
          width: 6248,
          height: 4176,
          ref: { uri: 'file:///data/frame.fits', bytes: 52_000_000, sha256: null },
        },
        statistics: { detectedStars: 412, medianHfrPixels: 2.4 },
        origin: 'capture-run',
      },
    }),
    seal({
      ...stamp(at),
      kind: 'solve',
      body: {
        status: 'solved',
        imageId,
        solverVersion: 'astap-test',
        solveMs: 800,
        hint: { raDegrees: 10, decDegrees: 20, radiusDegrees: 10 },
        centre: { raDegrees: 10.1, decDegrees: 20.1 },
        wcs: { width: 6248, height: 4176, referenceX: 3124, referenceY: 2088, raDegrees: 10.1, decDegrees: 20.1, cd: [-0.0003, 0, 0, 0.0003] },
      },
    }),
    seal({ ...stamp(at), kind: 'solve', body: { status: 'no-solution', imageId, solverVersion: 'astap-test', solveMs: 5000, hint: null, reason: 'no-match' } }),
    seal({ ...stamp(at), kind: 'session', body: { phase: 'started', setupId: 'setup-1', mode: 'observing', note: null } }),
    seal({ ...stamp(at), kind: 'gap', body: { source: sourceId('test:samples'), from: epochMs(at - 10_000), to: null, reason: 'dropped', dropped: 3 } }),
    seal({ ...stamp(at), kind: 'mount-position', body: { state: 'unknown', since: epochMs(at), reason: 'session-start', lastFix: null } }),
    seal({ ...stamp(at), kind: 'pointing-fix', body: { outcome: 'rejected', imageId, reason: 'no-solution' } }),
  ]
}
