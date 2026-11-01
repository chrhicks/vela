import { closeSync, fstatSync, openSync, createReadStream, readSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { createJournalImporter, decodeLine, encodeEvent, rigId, sourceId } from '@vela/rig-events'

const traces = join(homedir(), '.local/share/vela/traces')

const defaults = ['cria-journal-20261015-20261025.jsonl', 'cria-journal.jsonl'].map(name => join(traces, name))

const files = process.argv.slice(2).length > 0 ? process.argv.slice(2) : defaults

const roundTripEvery = 1000

interface Tally {
  lines: number
  failures: number
  byKind: Map<string, number>
  roundTrips: number
  roundTripFailures: number
  incompleteTail: boolean
  firstFailures: string[]
}

async function decodeFile(path: string): Promise<Tally> {
  const handle = openSync(path, 'r')
  const size = fstatSync(handle).size
  const last = Buffer.alloc(1)

  if (size > 0) readSync(handle, last, 0, 1, size - 1)
  closeSync(handle)

  const tally: Tally = {
    lines: 0,
    failures: 0,
    byKind: new Map(),
    roundTrips: 0,
    roundTripFailures: 0,
    incompleteTail: size > 0 && last[0] !== 10,
    firstFailures: [],
  }

  const importer = createJournalImporter({ rig: rigId('journal-import'), source: sourceId('import:vela-journal') })
  const lines = createInterface({ input: createReadStream(path, { start: 0, end: Math.max(0, size - 1) }), crlfDelay: Infinity })
  let held: string | undefined

  for await (const text of lines) {
    if (held !== undefined) tally.lines += read(importer, held, tally)
    held = text
  }

  if (held !== undefined && !tally.incompleteTail) tally.lines += read(importer, held, tally)

  return tally
}

function read(importer: ReturnType<typeof createJournalImporter>, text: string, tally: Tally): number {
  const result = importer.read(text)

  if (!result.ok) {
    tally.failures++

    if (tally.firstFailures.length < 3) tally.firstFailures.push(result.error.slice(0, 200))

    return 1
  }

  tally.byKind.set(result.event.kind, (tally.byKind.get(result.event.kind) ?? 0) + 1)

  if (tally.lines % roundTripEvery === 0) {
    tally.roundTrips++
    const again = decodeLine(encodeEvent(result.event))

    if (!again.ok || encodeEvent(again.event) !== encodeEvent(result.event)) tally.roundTripFailures++
  }

  return 1
}

let failed = false

for (const path of files) {
  const started = performance.now()
  const tally = await decodeFile(path)
  const kinds = [...tally.byKind].map(([kind, count]) => `${kind}=${count}`).join(' ')
  console.log(`${path.split('/').pop()}: ${tally.lines} lines, ${tally.failures} failures, ${kinds}`)
  console.log(`  round trip through the codec on every ${roundTripEvery}th line: ${tally.roundTrips} checked, ${tally.roundTripFailures} failed`)
  console.log(`  ${((performance.now() - started) / 1000).toFixed(1)} s${tally.incompleteTail ? ', last line still being written and left out' : ''}`)

  for (const failure of tally.firstFailures) console.log(`  first failure: ${failure}`)
  failed ||= tally.failures > 0 || tally.roundTripFailures > 0
}

process.exit(failed ? 1 : 0)
