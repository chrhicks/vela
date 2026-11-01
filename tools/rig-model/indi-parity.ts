import { createReadStream, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { createIndiImporter, createJournalImporter, decodeManifest, rigId, sourceId, type RigEvent } from '@vela/rig-events'

const option = (name: string, fallback: string) => {
  const index = process.argv.indexOf(`--${name}`)

  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback
}

const from = option('from', '2026-10-24T00:00:00Z')

const to = option('to', '2026-10-25T12:00:00Z')

const recordings = option('recordings', '/mnt/storage/rig/imports/errai-recordings')

const journal = option('journal', join(homedir(), '.local/share/vela/traces/cria-journal-20261015-20261025.jsonl'))

const windowStart = Date.parse(from)

const windowEnd = Date.parse(to)

if (Number.isNaN(windowStart) || Number.isNaN(windowEnd) || windowEnd <= windowStart) throw new Error('--from and --to must be ISO times with --from before --to')

interface Sample {
  readonly at: number
  readonly ra: number
  readonly dec: number
  readonly flags: Record<string, string | boolean>
}

interface Coverage {
  from: number
  to: number
  samples: Sample[]
}

function sampleOf(event: RigEvent): { instanceId: string; sample: Sample } | undefined {
  if (event.kind !== 'cria.state') return undefined

  const mount = event.body.state.devices.find(device => device.kind === 'mount')

  if (mount?.kind !== 'mount') return undefined

  const { rightAscensionHours: ra, declinationDegrees: dec, slewing, tracking, parked, pierSide, coordinateSystem, connected } = mount.readings

  if (ra.status === 'unavailable' || dec.status === 'unavailable') return undefined

  const flag = <T extends string | boolean>(reading: { status: string; value?: T }) => (reading.status === 'unavailable' ? 'unavailable' : reading.value)

  return {
    instanceId: event.body.state.instanceId,
    sample: {
      at: event.body.state.generatedAt,
      ra: ra.value,
      dec: dec.value,
      flags: {
        slewing: flag(slewing) ?? 'unavailable',
        tracking: flag(tracking) ?? 'unavailable',
        parked: flag(parked) ?? 'unavailable',
        pierSide: flag(pierSide) ?? 'unavailable',
        coordinateSystem: flag(coordinateSystem) ?? 'unavailable',
        connected: flag(connected) ?? 'unavailable',
      },
    },
  }
}

/** INDI's `%<width>.<fraction>m` prints sexagesimal; fraction 6 is whole seconds, 8 tenths, 9 hundredths. */
function displayStep(format: string): number {
  const fraction = /^%\d*\.(\d)m$/.exec(format)?.[1]

  const steps = new Map([
    ['3', 1 / 60],
    ['5', 0.1 / 60],
    ['6', 1 / 3600],
    ['8', 0.1 / 3600],
    ['9', 0.01 / 3600],
  ])

  const step = steps.get(fraction ?? '')

  if (step === undefined) throw new Error(`Unknown INDI number format ${format}`)

  return step
}

const timeOf = (line: string) => Number(/"at":(\d+)/.exec(line)?.[1] ?? Number.NaN)

const byInstance = new Map<string, Coverage>()

let format: string | undefined

let recordingBadLines = 0

async function readRecordings() {
  const folders = readdirSync(recordings).filter(name => Date.parse(name.slice(0, 10)) <= windowEnd).sort()

  for (const folder of folders) {
    const manifest = decodeManifest(JSON.parse(readFileSync(join(recordings, folder, 'manifest.json'), 'utf8')))
    const importer = createIndiImporter({ rig: rigId('parity'), source: sourceId('import:indi-recording'), manifest })
    const coverage = byInstance.get(manifest.instanceId) ?? { from: Number.POSITIVE_INFINITY, to: 0, samples: [] }
    const lines = createInterface({ input: createReadStream(join(recordings, folder, 'traffic.jsonl')), crlfDelay: Infinity })

    byInstance.set(manifest.instanceId, coverage)

    for await (const line of lines) {
      const at = timeOf(line)

      if (at >= windowEnd) break

      if (at >= windowStart) {
        coverage.from = Math.min(coverage.from, at)
        coverage.to = Math.max(coverage.to, at)
      }

      if (format === undefined && line.includes('defNumberVector') && line.includes('EQUATORIAL_EOD_COORD'))
        format = /<defNumber name="RA"[^>]*format="([^"]*)"/.exec(JSON.parse(line).xml)?.[1]

      const result = importer.read(line)

      if (result === undefined) continue

      if (!result.ok) {
        recordingBadLines++
        continue
      }

      const found = sampleOf(result.event)

      if (found !== undefined && found.sample.at >= windowStart) coverage.samples.push(found.sample)
    }
  }
}

const circular = (a: number, b: number, period: number) => Math.min(Math.abs(a - b), period - Math.abs(a - b))

async function compareJournal() {
  const importer = createJournalImporter({ rig: rigId('parity'), source: sourceId('import:vela-journal') })
  const lines = createInterface({ input: createReadStream(journal), crlfDelay: Infinity })
  const cursor = new Map<string, number>()
  const tally = { compared: 0, slewing: 0, positions: new Set<number>(), outsideRecording: 0, unreadable: 0, undecodable: 0, maxRaHours: 0, maxDecDegrees: 0 }
  const disagreements = new Map<string, number>()

  for await (const line of lines) {
    const at = timeOf(line)

    if (at >= windowEnd) break

    const result = importer.read(line)

    if (!result.ok) {
      tally.undecodable++
      continue
    }

    const found = sampleOf(result.event)

    if (result.event.at < windowStart || result.event.kind !== 'cria.state') continue

    if (found === undefined) {
      tally.unreadable++
      continue
    }

    const coverage = byInstance.get(found.instanceId)
    const { sample } = found

    if (coverage === undefined || sample.at < coverage.from || sample.at > coverage.to) {
      tally.outsideRecording++
      continue
    }

    let index = cursor.get(found.instanceId) ?? 0

    while (index + 1 < coverage.samples.length && coverage.samples[index + 1]!.at <= sample.at) index++

    cursor.set(found.instanceId, index)

    const recorded = coverage.samples[index]

    if (recorded === undefined || recorded.at > sample.at) {
      tally.outsideRecording++
      continue
    }

    tally.compared++
    tally.positions.add(sample.ra)

    if (sample.flags.slewing === true) tally.slewing++

    tally.maxRaHours = Math.max(tally.maxRaHours, circular(sample.ra, recorded.ra, 24))
    tally.maxDecDegrees = Math.max(tally.maxDecDegrees, Math.abs(sample.dec - recorded.dec))

    for (const [name, value] of Object.entries(sample.flags))
      if (recorded.flags[name] !== value) disagreements.set(name, (disagreements.get(name) ?? 0) + 1)
  }

  return { tally, disagreements }
}

const started = performance.now()

await readRecordings()

if (format === undefined) {
  console.log('No EQUATORIAL_EOD_COORD definition found in the recordings, so there is no display step to compare against.')
  process.exit(2)
}

const step = displayStep(format)

const { tally, disagreements } = await compareJournal()

const recorded = [...byInstance.values()].reduce((total, coverage) => total + coverage.samples.length, 0)

const raSteps = tally.maxRaHours / step

const decSteps = tally.maxDecDegrees / step

const withinStep = raSteps <= 1 && decSteps <= 1

console.log(`window ${from} to ${to}, INDI number format ${format}, one display step = ${(step * 3600).toFixed(2)} s of time in RA and ${(step * 3600).toFixed(2)} arcsec in Dec`)

console.log(`recordings: ${byInstance.size} Cria runs, ${recorded} mount states in the window, ${recordingBadLines} lines that did not decode`)

console.log(`journal: ${tally.compared} states compared, ${tally.outsideRecording} outside any recording, ${tally.unreadable} without a position, ${tally.undecodable} that did not decode`)

console.log(`${tally.slewing} of them while slewing, ${tally.positions.size} different right ascensions`)

console.log(`largest RA difference ${(tally.maxRaHours * 3600).toFixed(2)} s of time (${raSteps.toFixed(2)} steps)`)

console.log(`largest Dec difference ${(tally.maxDecDegrees * 3600).toFixed(2)} arcsec (${decSteps.toFixed(2)} steps)`)

console.log(disagreements.size === 0 ? 'flags (slewing, tracking, parked, pierSide, coordinateSystem, connected): no disagreement' : `flag disagreements: ${[...disagreements].map(([name, count]) => `${name}=${count}`).join(' ')}`)

console.log(`${((performance.now() - started) / 1000).toFixed(1)} s`)

process.exit(tally.compared > 0 && withinStep && disagreements.size === 0 ? 0 : 1)
