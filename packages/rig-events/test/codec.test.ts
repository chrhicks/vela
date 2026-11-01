import { describe, expect, it } from 'vitest'
import { decodeEvent, decodeLine, encodeEvent, kinds, type Kind } from '@vela/rig-events'
import { sampleEvents } from './samples.ts'

describe('the codec', () => {
  it('has a sample for every kind in the registry, so the round trip below covers them all', () => {
    // SAFETY: `kinds` is a record keyed by Kind.
    const registered = Object.keys(kinds) as Kind[]

    expect(new Set(sampleEvents().map(event => event.kind))).toEqual(new Set(registered))
  })

  it('round-trips every kind through one canonical line', () => {
    for (const event of sampleEvents()) {
      const line = encodeEvent(event)
      const decoded = decodeLine(line)

      expect(decoded.ok, `${event.kind} decodes`).toBe(true)

      if (decoded.ok) {
        expect(decoded.event).toEqual(event)
        expect(encodeEvent(decoded.event), `${event.kind} re-encodes to the same bytes`).toBe(line)
      }
    }
  })

  it('writes a single line', () => {
    for (const event of sampleEvents()) expect(encodeEvent(event)).not.toContain('\n')
  })

  it('rejects an unknown kind with a reason and keeps the raw input', () => {
    const [first] = sampleEvents()
    const result = decodeEvent({ ...first, kind: 'cria.cells' })

    expect(result.ok).toBe(false)

    if (!result.ok) expect(result.raw).toMatchObject({ kind: 'cria.cells' })
  })

  it('rejects a body that does not match its kind', () => {
    const [, exchange] = sampleEvents()
    const result = decodeEvent({ ...exchange, kind: 'cria.image' })

    expect(result.ok).toBe(false)
  })

  it('rejects a version other than 1, a missing field and text that is not JSON', () => {
    const [first] = sampleEvents()
    const { seenAt: _seenAt, ...withoutSeenAt } = first!

    expect(decodeEvent({ ...first, v: 2 }).ok).toBe(false)
    expect(decodeEvent(withoutSeenAt).ok).toBe(false)
    expect(decodeLine('{not json').ok).toBe(false)
  })

  it('rejects a snapshot whose protocol version is not 5', () => {
    const [first] = sampleEvents()
    const bad = JSON.parse(encodeEvent(first!))
    bad.body.state.protocolVersion = 4

    expect(decodeEvent(bad).ok).toBe(false)
  })
})
