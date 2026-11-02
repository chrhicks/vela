import { describe, expect, it } from 'vitest'
import { decodeLine, encodeEvent, epochMs, rigId, seal, sourceId } from '@vela/rig-events'

const golden =
  '{"at":1792000000000,"body":{"items":[{"item":"astap","observed":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","pinned":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","status":"match"},{"item":"catalog","observed":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","pinned":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","status":"changed"},{"item":"cria/test-rig","observed":null,"pinned":"{\\"protocolVersion\\":5}","status":"missing"},{"item":"optics/test-rig","observed":"focalLengthMm=400;camera=Main camera","pinned":null,"status":"unpinned"}],"pinnedAt":"2026-10-26T19:00:00.000Z"},"id":"attestation:test-rig:1792000000000","kind":"attestation","rig":"test-rig","seenAt":1792000000000,"source":"vela:attestation","v":1}'

describe('the attestation event', () => {
  const event = seal({
    rig: rigId('test-rig'),
    source: sourceId('vela:attestation'),
    kind: 'attestation',
    at: epochMs(1_792_000_000_000),
    seenAt: epochMs(1_792_000_000_000),
    body: {
      pinnedAt: '2026-10-26T19:00:00.000Z',
      items: [
        { item: 'astap', status: 'match', pinned: 'a'.repeat(64), observed: 'a'.repeat(64) },
        { item: 'catalog', status: 'changed', pinned: 'b'.repeat(64), observed: 'c'.repeat(64) },
        { item: 'cria/test-rig', status: 'missing', pinned: '{"protocolVersion":5}', observed: null },
        { item: 'optics/test-rig', status: 'unpinned', pinned: null, observed: 'focalLengthMm=400;camera=Main camera' },
      ],
    },
  })

  it('is written as exactly this line', () => {
    expect(encodeEvent(event)).toBe(golden)
  })

  it('reads back from that line', () => {
    expect(decodeLine(golden)).toEqual({ ok: true, event })
  })

  it('rejects a status that is not one of the four', () => {
    const bad = golden.replace('"status":"match"', '"status":"fine"')

    expect(decodeLine(bad).ok).toBe(false)
  })
})
