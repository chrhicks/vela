import { describe, expect, it } from 'vitest'
import { criaEvent, decodeLine, encodeEvent, rigId, sourceId, type CriaEntry } from '@vela/rig-events'
import { mountState } from '@vela/rig-testing'

const context = { rig: rigId('test-rig'), source: sourceId('vela:cria') }

const origin = 'http://cria.test'

function snapshot(sequence: number, at: number) {
  return mountState({ sequence, generatedAt: at, mount: { at, raHours: 5.5, decDegrees: -5.4 } })
}

function readBack(entry: CriaEntry) {
  const event = criaEvent(entry, context)
  const decoded = decodeLine(encodeEvent(event))

  if (!decoded.ok) throw new Error(decoded.error)
  expect(decoded.event).toEqual(event)

  return decoded.event
}

describe('a Cria client entry as an envelope', () => {
  it('keeps the whole snapshot, stamped with when Cria made it and when Vela saw it', () => {
    const state = snapshot(7, 1_792_000_000_000)
    const event = readBack({ kind: 'state', at: 1_792_000_000_040, origin, state })

    expect(event).toMatchObject({ kind: 'cria.state', at: 1_792_000_000_000, seenAt: 1_792_000_000_040, source: context.source })
    expect(event.kind === 'cria.state' && event.body).toEqual({ origin, freshness: 'observed', state })
  })

  it('keeps a snapshot that differs from the last only in observedAt', () => {
    const first = readBack({ kind: 'state', at: 1_792_000_001_000, origin, state: snapshot(7, 1_792_000_001_000) })
    const second = readBack({ kind: 'state', at: 1_792_000_002_000, origin, state: snapshot(8, 1_792_000_002_000) })
    const observed = (event: typeof first) => (event.kind === 'cria.state' ? event.body.state.devices[0]?.readings : undefined)

    expect(second.id).not.toBe(first.id)
    expect(JSON.stringify(observed(second))).toContain('1792000002000')
    expect(JSON.stringify(observed(first))).not.toContain('1792000002000')
  })

  it('keeps a snapshot whose only change is observedAt', () => {
    const at = 1_792_000_003_000
    const before = mountState({ sequence: 9, generatedAt: at, mount: { at: at - 5_000, raHours: 5.5, decDegrees: -5.4 } })
    const after = mountState({ sequence: 9, generatedAt: at, mount: { at, raHours: 5.5, decDegrees: -5.4 } })
    const withoutObservedAt = (state: typeof before) => JSON.stringify(state, (key, value) => (key === 'observedAt' ? undefined : value))

    expect(withoutObservedAt(after)).toBe(withoutObservedAt(before))

    const kept = readBack({ kind: 'state', at, origin, state: after })

    expect(kept.kind === 'cria.state' && kept.body.state).toEqual(after)
    expect(JSON.stringify(after)).not.toBe(JSON.stringify(before))
  })

  it('turns a decoded reply body into plain JSON and drops one that has none', () => {
    const exchange = {
      kind: 'exchange',
      at: 1_792_000_100_000,
      origin,
      ms: 12,
      method: 'POST',
      route: '/v2/operations',
      status: 202,
      command: { requestId: 'r-1', deviceId: 'mount', kind: 'slew', parameters: { raHours: 1, skipped: undefined } },
      reply: { kind: 'answered', body: { id: 'op', when: new Date(1_792_000_100_000) } },
    } as const satisfies CriaEntry

    const event = readBack(exchange)

    expect(event.kind === 'cria.exchange' && event.body.reply).toEqual({ kind: 'answered', body: { id: 'op', when: '2026-10-14T17:48:20.000Z' } })
    expect(event.kind === 'cria.exchange' && event.body.command?.parameters).toEqual({ raHours: 1 })

    const bare = readBack({ ...exchange, command: null, reply: { kind: 'answered', body: undefined } })

    expect(bare.kind === 'cria.exchange' && bare.body.reply).toEqual({ kind: 'answered' })
  })

  it('carries the other reply kinds, image checks and stream marks unchanged', () => {
    const refused = { kind: 'refused', code: 'device-busy', message: 'busy' } as const
    const lost = { kind: 'lost', message: 'timed out' } as const
    const base = { kind: 'exchange', at: 1_792_000_100_000, origin, ms: 3, method: 'GET', route: '/v2/state', status: null, command: null } as const

    expect(readBack({ ...base, reply: refused }).kind === 'cria.exchange').toBe(true)
    expect(readBack({ ...base, reply: lost }).kind === 'cria.exchange').toBe(true)

    expect(readBack({ kind: 'image', at: 1_792_000_100_000, origin, imageId: 'i', operationId: 'o', bytes: 10, sha256: 'a'.repeat(64), verdict: 'intact' }).kind).toBe('cria.image')
    expect(readBack({ kind: 'stream', at: 1_792_000_100_000, origin, event: 'ended', message: 'reset' }).kind).toBe('cria.stream')
  })

  it('does not throw on a body JSON cannot hold', () => {
    const circular = { self: {} }

    circular.self = circular

    expect(() =>
      criaEvent({ kind: 'exchange', at: 1, origin, ms: 1, method: 'GET', route: '/x', status: 200, command: null, reply: { kind: 'answered', body: circular } }, context),
    ).not.toThrow()
  })
})
