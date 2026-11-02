import { mkdtemp } from '../testing/temp-dir.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { criaEvent, encodeEvent, epochMs, rigId, sourceId, type State } from '@vela/rig-events'
import { mountState } from '@vela/rig-testing'
import { loggedMount } from './backfill-sources.ts'
import { logLines } from './log-lines.ts'

const T0 = Date.UTC(2030, 0, 1, 3, 0, 0)

const state = (index: number) => mountState({ sequence: index, mount: { at: T0 + index * 1000, raHours: 5 + index * 0.01, decDegrees: -5 } })

const runLogLine = (index: number, generatedAt = T0 + index * 1000) =>
  encodeEvent(criaEvent({ kind: 'state', at: T0 + index * 1000 + 40, origin: 'http://cria.test', state: mountState({ sequence: index, generatedAt, mount: { at: generatedAt, raHours: 5, decDegrees: -5 } }) }, { rig: rigId('test-rig'), source: sourceId('vela:cria') }))

type Cell = ReturnType<typeof JSON.parse>

function journalBaseline(snapshot: State): string {
  const changed: Record<string, Cell> = {}

  for (const device of snapshot.devices) {
    const { readings, ...rest } = device

    for (const [field, reading] of Object.entries(readings)) changed[`device/${device.id}/readings.${field}`] = reading

    for (const [field, value] of Object.entries(rest)) changed[`device/${device.id}/${field}`] = value
  }

  return JSON.stringify({ kind: 'state', at: snapshot.generatedAt + 20, origin: 'http://cria.test', generatedAt: snapshot.generatedAt, sequence: snapshot.sequence, instanceId: snapshot.instanceId, commandsEnabled: false, baseline: true, changed, removed: [] })
}

async function files() {
  const root = await mkdtemp(join(tmpdir(), 'rig-model-log-'))
  const runLog = join(root, 'run-log')

  await mkdir(runLog)
  await writeFile(join(root, 'cria-journal.jsonl'), `${journalBaseline(state(0))}\n`)
  await writeFile(join(runLog, 'run-20300101T040000000Z-00002.jsonl'), `${runLogLine(4)}\n${runLogLine(5)}\n`)
  await writeFile(join(runLog, 'run-20300101T040000000Z-00001.jsonl'), `${runLogLine(2)}\n${runLogLine(3)}\n{"at":`)
  await writeFile(join(runLog, 'notes.txt'), 'not a run-log file\n')

  return { root, runLog, journal: join(root, 'cria-journal.jsonl') }
}

const window = { from: epochMs(T0 - 1000), to: epochMs(T0 + 10_000) }

describe('reading Vela logs', () => {
  it('gives the lines of a run-log directory in name order and leaves other files out', async () => {
    const { runLog } = await files()
    const lines: string[] = []

    for await (const line of logLines([runLog])) lines.push(line)

    const sequences = lines.flatMap(line => {
      try {
        return [JSON.parse(line).body.state.sequence]
      } catch {
        return []
      }
    })

    expect(sequences).toEqual([2, 3, 4, 5])
    expect(lines).toHaveLength(5)
  })

  it('reads the mount from an old journal file and a run-log directory together, oldest first', async () => {
    const { runLog, journal } = await files()
    const sequences: number[] = []
    const freshness: string[] = []

    for await (const event of loggedMount([journal, runLog], window)) {
      if (event.kind !== 'cria.state') continue

      sequences.push(event.body.state.sequence)
      freshness.push(event.body.freshness)
    }

    expect(sequences).toEqual([0, 2, 3, 4, 5])
    expect(freshness).toEqual(['qualified', 'observed', 'observed', 'observed', 'observed'])
  })

  it('keeps only the snapshots Vela saw inside the window', async () => {
    const { runLog } = await files()
    const seen: number[] = []

    for await (const event of loggedMount([runLog], { from: epochMs(T0 + 3000), to: epochMs(T0 + 5000) })) seen.push(event.seenAt)

    expect(seen).toEqual([T0 + 3040, T0 + 4040])
  })

  it('stops on when Vela saw a snapshot, not on the time Cria stamped it', async () => {
    const { root } = await files()
    const skewed = join(root, 'skewed.jsonl')

    await writeFile(skewed, `${runLogLine(1, T0 + 20_000)}\n${runLogLine(2)}\n${runLogLine(20)}\n`)

    const seen: number[] = []

    for await (const event of loggedMount([skewed], { from: epochMs(T0), to: epochMs(T0 + 10_000) })) seen.push(event.seenAt)

    expect(seen).toEqual([T0 + 1040, T0 + 2040])
  })
})
