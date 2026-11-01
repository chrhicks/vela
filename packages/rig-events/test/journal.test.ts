import { describe, expect, it } from 'vitest'
import { createJournalImporter, encodeEvent, rigId, sourceId, type RigEvent, type State } from '@vela/rig-events'
import { mountState } from '@vela/rig-testing'

type Cell = ReturnType<typeof JSON.parse>

function cellsOf(state: State): Map<string, Cell> {
  const cells = new Map<string, Cell>()

  for (const device of state.devices) {
    const { readings, ...rest } = device

    for (const [field, reading] of Object.entries(readings)) cells.set(`device/${device.id}/readings.${field}`, reading)

    for (const [field, value] of Object.entries(rest)) cells.set(`device/${device.id}/${field}`, value)
  }

  for (const operation of state.operations) cells.set(`operation/${operation.id}`, operation)

  return cells
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- A JSON.stringify replacer receives any value.
const withoutObservedAt = (key: string, value: unknown) => (key === 'observedAt' ? undefined : value)

function journalLines(states: readonly State[], origin = 'http://cria.test'): string[] {
  let previous: Map<string, Cell> | undefined

  return states.map((state, index) => {
    const current = cellsOf(state)
    const changed: Record<string, Cell> = {}
    const removed: string[] = []

    for (const [key, cell] of current)
      if (JSON.stringify(previous?.get(key), withoutObservedAt) !== JSON.stringify(cell, withoutObservedAt)) changed[key] = cell

    if (previous) for (const key of previous.keys()) if (!current.has(key)) removed.push(key)

    const line = JSON.stringify({
      kind: 'state',
      at: state.generatedAt + 20,
      origin,
      generatedAt: state.generatedAt,
      sequence: state.sequence,
      instanceId: state.instanceId,
      commandsEnabled: state.commandsEnabled,
      baseline: index === 0,
      changed,
      removed,
    })

    previous = current

    return line
  })
}

const importer = () => createJournalImporter({ rig: rigId('test-rig'), source: sourceId('import:test') })

function readAll(lines: readonly string[], into = importer()): RigEvent[] {
  return lines.map(line => {
    const result = into.read(line)

    if (!result.ok) throw new Error(result.error)

    return result.event
  })
}

const at = 1_792_000_000_000

const walk = [0, 1, 2, 3].map(index => mountState({ sequence: 100 + index, mount: { at: at + index * 1000, raHours: 5 + index * 0.001, decDegrees: -5, slewing: index === 2 } }))

describe('the journal importer', () => {
  it('rebuilds the snapshots Vela diffed into cells', () => {
    const events = readAll(journalLines(walk))

    expect(events).toHaveLength(4)
    events.forEach((event, index) => {
      expect(event.kind).toBe('cria.state')

      if (event.kind === 'cria.state') {
        const expected = walk[index]!
        const mount = event.body.state.devices[0]
        expect(mount?.kind === 'mount' && mount.readings.rightAscensionHours).toEqual(
          expected.devices[0]?.kind === 'mount' ? { ...expected.devices[0].readings.rightAscensionHours } : undefined,
        )
        expect(event.body.state.sequence).toBe(expected.sequence)
      }
    })
  })

  it('marks every rebuilt snapshot as qualified and stamps its own clock and the arrival time', () => {
    const [first] = readAll(journalLines(walk))

    expect(first?.kind === 'cria.state' && first.body.freshness).toBe('qualified')
    expect(first?.at).toBe(walk[0]!.generatedAt)
    expect(first?.seenAt).toBe(walk[0]!.generatedAt + 20)
  })

  it('keeps a reading that did not change, with the observedAt of its last change', () => {
    const states = [0, 1].map(index => mountState({ sequence: index, mount: { at: at + index * 1000, raHours: 5, decDegrees: -5 } }))
    const lines = journalLines(states)

    expect(Object.keys(JSON.parse(lines[1]!).changed)).toEqual([])

    const second = readAll(lines)[1]
    const mount = second?.kind === 'cria.state' ? second.body.state.devices[0] : undefined

    expect(mount?.kind === 'mount' && mount.readings.rightAscensionHours).toMatchObject({ status: 'fresh', value: 5, observedAt: at })
  })

  it('removes a cell the journal lists as removed', () => {
    const withOperation = { ...walk[0]!, operations: [] }
    const lines = journalLines([withOperation, walk[1]!])
    const removal = { ...JSON.parse(lines[1]!), removed: ['device/mount/lastCommandedSetpointC'] }

    expect(readAll([lines[0]!, JSON.stringify(removal)])).toHaveLength(2)
  })

  it('replaces everything at a baseline, so a new Vela process starts clean', () => {
    const lines = journalLines(walk)
    const restarted = journalLines([walk[3]!])
    const events = readAll([...lines, ...restarted])

    expect(events).toHaveLength(5)
    expect(events[4]?.kind === 'cria.state' && events[4].body.state.sequence).toBe(walk[3]!.sequence)
  })

  it('refuses a delta that arrives before any baseline and says why', () => {
    const [, delta] = journalLines(walk)
    const result = importer().read(delta!)

    expect(result.ok).toBe(false)

    if (!result.ok) expect(result.error).toContain('before any baseline')
  })

  it('keeps each origin separate', () => {
    const into = importer()
    const first = journalLines(walk, 'http://a.test')
    const second = journalLines(walk, 'http://b.test')

    expect(readAll([first[0]!, second[0]!, first[1]!, second[1]!], into)).toHaveLength(4)
  })

  it('refuses a rebuilt snapshot that is not a protocol-5 State', () => {
    const [baseline] = journalLines(walk)
    const damaged = JSON.parse(baseline!)
    damaged.changed['device/mount/readings.rightAscensionHours'] = { status: 'fresh', value: 'five', observedAt: at }
    const result = importer().read(JSON.stringify(damaged))

    expect(result.ok).toBe(false)
  })

  it('maps exchanges, image checks and stream events one to one', () => {
    const lines = [
      { kind: 'exchange', at, origin: 'http://cria.test', ms: 3, method: 'POST', route: '/v2/operations', status: 202, command: { requestId: 'r', deviceId: 'mount', kind: 'slew', parameters: { raHours: 1 } }, reply: { kind: 'answered', body: { ok: true } } },
      { kind: 'exchange', at, origin: 'http://cria.test', ms: 3, method: 'GET', route: '/v2/state', status: null, command: null, reply: { kind: 'lost', message: 'timeout' } },
      { kind: 'image', at, origin: 'http://cria.test', imageId: 'i', operationId: 'o', bytes: 5, sha256: 'a'.repeat(64), verdict: 'gone' },
      { kind: 'stream', at, origin: 'http://cria.test', event: 'ended', message: 'closed' },
    ].map(line => JSON.stringify(line))

    expect(readAll(lines).map(event => event.kind)).toEqual(['cria.exchange', 'cria.exchange', 'cria.image', 'cria.stream'])
  })

  it('gives the same line the same id on every import, and a different line a different one', () => {
    const lines = journalLines(walk)
    const first = readAll(lines).map(event => event.id)
    const again = readAll(lines).map(event => event.id)

    expect(again).toEqual(first)
    expect(new Set(first).size).toBe(first.length)
  })

  it('imports to bytes that do not change between runs', () => {
    const lines = journalLines(walk)

    expect(readAll(lines).map(encodeEvent)).toEqual(readAll(lines).map(encodeEvent))
  })

  it('reports a line that is not JSON or not a journal entry', () => {
    const into = importer()

    expect(into.read('{broken').ok).toBe(false)
    expect(into.read(JSON.stringify({ kind: 'mystery', at })).ok).toBe(false)
  })
})
