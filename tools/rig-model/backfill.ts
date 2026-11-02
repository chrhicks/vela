import { mkdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { astapVersion } from '@vela/rig-astap'
import type { SkyPosition } from '@vela/rig-events'
import { nightOf, pathsIn, scanFrameSources, type SavedImage } from '@vela/rig-frames'
import { observeMount } from '@vela/rig-model'
import { driftsOf, findingOf, outcomeOf, pointingOf, type Exposure } from './backfill-analysis.ts'
import { markdownOf, tally, type NightResult } from './backfill-report.ts'
import { replayNight, type Capture, type Solved } from './backfill-replay.ts'
import { commandedExposures, journaledMount, nightWindow, overlapping, readRecordings, recordedMount } from './backfill-sources.ts'
import { inParallel, sha256File, solveCache, solveImage } from './backfill-solve.ts'

const usage = `usage: backfill.ts --out DIR [--report FILE.md] [--recordings DIR] [--journal FILE]... [--data DIR]
  [--utc-offset-minutes N] [--from-night DATE] [--through-night DATE] [--event-night DATE] [--control-night DATE]
  [--astap FILE] [--catalog DIR] [--field-height-degrees N] [--jobs N] [--timeout-ms N]
exit 0 complete, 1 failed, 2 bad arguments, 3 incomplete`

function options(): Map<string, string[]> {
  const found = new Map<string, string[]>()

  for (let index = 2; index < process.argv.length; index += 2) {
    const name = process.argv[index]
    const value = process.argv[index + 1]

    if (!name?.startsWith('--') || value === undefined) {
      console.error(usage)
      process.exit(2)
    }

    found.set(name.slice(2), [...(found.get(name.slice(2)) ?? []), value])
  }

  return found
}

const given = options()

const option = (name: string): string | undefined => given.get(name)?.[0]

const share = join(homedir(), '.local/share/vela')

const outDirectory = option('out')

if (outDirectory === undefined) {
  console.error(usage)
  process.exit(2)
}

const dataDirectory = option('data') ?? process.env.VELA_DATA_DIR ?? share

const utcOffsetMinutes = Number(option('utc-offset-minutes') ?? '0')

const fromNight = option('from-night') ?? ''

const throughNight = option('through-night') ?? '9999-12-31'

const jobs = Number(option('jobs') ?? '4')

const journals = given.get('journal') ?? [join(share, 'traces/cria-journal-20261015-20261025.jsonl'), join(share, 'traces/cria-journal.jsonl')]

const sources = await scanFrameSources(pathsIn(dataDirectory))

if (sources.problems.length > 0) {
  console.error(`failed: ${sources.problems.length} frame sources could not be read, the first ${sources.problems[0]?.reason}`)
  process.exit(1)
}

const recordings = option('recordings') === undefined ? [] : await readRecordings(option('recordings')!)

const executable = option('astap') ?? join(share, 'astap/astap_cli')

const trialFrame = sources.trials.trials.flatMap(trial => trial.frames)[0]

const fieldHeightDegrees = Number(option('field-height-degrees') ?? trialFrame?.fieldHeightDegrees)

if (!(fieldHeightDegrees > 0)) {
  console.error('no --field-height-degrees, and no alignment trial to take it from')
  process.exit(2)
}

const solver = {
  executable,
  catalogPath: option('catalog') ?? join(share, 'astap/catalog/opt/astap'),
  fieldHeightDegrees,
  solverVersion: await astapVersion(executable),
  timeoutMs: Number(option('timeout-ms') ?? '60000'),
}

const cache = solveCache(join(outDirectory, 'solves'), solver.solverVersion, fieldHeightDegrees)

const records = new Map(sources.join.joined.map(joined => [joined.image.id, joined.record]))

const images = [...sources.join.joined.map(joined => joined.image), ...sources.join.imagesWithoutRecord.predatesRecords, ...sources.join.imagesWithoutRecord.unexplained]

const inRange = (image: SavedImage) => {
  const night = nightOf(image.capturedAt, utcOffsetMinutes)

  return night >= fromNight && night <= throughNight
}

const captures: Capture[] = images
  .flatMap((image): Capture[] => (image.frameType === 'light' ? [{ image, record: records.get(image.id) }] : []))

const byNight = new Map<string, Capture[]>()

for (const capture of captures) {
  const night = nightOf(capture.image.capturedAt, utcOffsetMinutes)

  byNight.set(night, [...(byNight.get(night) ?? []), capture])
}

const nightNames = [...byNight.keys()].filter(night => night >= fromNight && night <= throughNight).toSorted()

const kept: Exposure[] = [
  ...sources.savedImages.images.map(image => ({ at: image.capturedAt, seconds: image.exposureSeconds })),
  ...sources.trials.trials.flatMap(trial => trial.frames.filter(frame => frame.onDisk).map(frame => ({ at: frame.capturedAt, seconds: trial.exposureSeconds }))),
]

const mountOf = (night: string) => {
  const window = nightWindow(night, utcOffsetMinutes)

  return overlapping(recordings, window).length > 0 ? { source: 'recordings' as const, events: () => recordedMount(recordings, window) } : { source: 'journal' as const, events: () => journaledMount(journals, window) }
}

/** Where the mount pointed, a sample every 30 s, only to give ASTAP a place to start looking. */
async function hintTrack(night: string): Promise<{ at: number; position: SkyPosition }[]> {
  const track: { at: number; position: SkyPosition }[] = []

  for await (const event of mountOf(night).events()) {
    const position = event.kind === 'cria.state' ? observeMount(event.body.state)?.position : undefined

    if (position && (track.length === 0 || event.seenAt - track[track.length - 1]!.at >= 30_000)) track.push({ at: event.seenAt, position: { raDegrees: position.raHours * 15, decDegrees: position.decDegrees } })
  }

  return track
}

const blindHint: SkyPosition = { raDegrees: 0, decDegrees: 0 }

function hintAt(track: readonly { at: number; position: SkyPosition }[], time: number): SkyPosition {
  const nearest = track.reduce<(typeof track)[number] | undefined>((best, sample) => (best === undefined || Math.abs(sample.at - time) < Math.abs(best.at - time) ? sample : best), undefined)

  return nearest !== undefined && Math.abs(nearest.at - time) < 6 * 3_600_000 ? nearest.position : blindHint
}

const results: NightResult[] = []

const cacheCounts = { hits: 0, solved: 0 }

for (const night of nightNames) {
  const nightCaptures = byNight.get(night) ?? []
  const digests = await inParallel(nightCaptures, 8, capture => sha256File(capture.image.fitsPath))
  const cached = await inParallel(nightCaptures, 8, (capture, index) => cache.read(digests[index]!, capture.image))
  const missing = nightCaptures.flatMap((capture, index) => (cached[index] === undefined ? [index] : []))
  const hints = missing.length === 0 ? [] : await hintTrack(night)
  let done = 0

  console.log(`night ${night}: ${nightCaptures.length} light frames, ${nightCaptures.length - missing.length} solved before, ${missing.length} to solve`)

  const solvedNow = await inParallel(missing, jobs, async index => {
    const capture = nightCaptures[index]!
    const body = await solveImage(solver, capture.image, hintAt(hints, capture.image.capturedAt + capture.image.exposureSeconds * 500))

    await cache.write(digests[index]!, body)

    if (++done % 25 === 0) console.log(`  solved ${done} of ${missing.length}`)

    return body
  })

  cacheCounts.hits += nightCaptures.length - missing.length
  cacheCounts.solved += missing.length

  const solved: Solved[] = nightCaptures.map((capture, index) => {
    const body = cached[index] ?? solvedNow[missing.indexOf(index)]

    if (body === undefined) throw new Error('a frame has neither a cached nor a fresh solve')

    return { capture, body }
  })

  const window = nightWindow(night, utcOffsetMinutes)
  const mount = mountOf(night)
  const { rows, mountEvents } = await replayNight({ solved, mount: mount.events(), settleMs: 10 * 60_000 })
  const trials = sources.trials.trials.filter(trial => trial.createdAt >= window.from && trial.createdAt < window.to)
  const drifts = driftsOf(rows)
  const commanded = mount.source === 'recordings' ? await commandedExposures(recordings, window) : undefined

  results.push({ night, window, mountSource: mountEvents === 0 ? 'none' : mount.source, rows, trials, drifts, finding: findingOf({ drifts, trials, commanded, kept }) })

  console.log(`  joined ${rows.filter(row => pointingOf(row).kind === 'fix').length} of ${rows.length}, ${drifts.length} fitted runs`)
}

const eventNight = option('event-night')

const controlNight = option('control-night')

const markdown = markdownOf({ nights: results, solverVersion: solver.solverVersion, utcOffsetMinutes, images: tally(images.flatMap(image => (inRange(image) ? [image.frameType] : []))), listed: eventNight })

async function replace(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(`${path}.tmp`, content)
  await rename(`${path}.tmp`, path)
}

await replace(
  join(outDirectory, 'frames.jsonl'),
  results
    .flatMap(night =>
      night.rows.map(row => {
        const pointing = pointingOf(row)

        return JSON.stringify({
          night: night.night,
          imageId: row.imageId,
          capturedAt: new Date(row.capturedAt).toISOString(),
          exposureSeconds: row.exposureSeconds,
          solve: row.solve,
          join: pointing.kind === 'fix' ? 'fix' : pointing.reason,
          epoch: pointing.kind === 'fix' ? pointing.epoch : null,
          arcmin: pointing.kind === 'fix' ? pointing.arcmin : null,
        })
      }),
    )
    .join('\n') + '\n',
)

await replace(option('report') ?? join(outDirectory, 'report.md'), markdown)

const outcome = outcomeOf(results, { event: eventNight, control: controlNight })

console.log(`solves: ${cacheCounts.hits} from the cache, ${cacheCounts.solved} solved now`)

console.log(`${outcome.word}${outcome.reasons.map(reason => `\n  ${reason}`).join('')}`)

process.exit(outcome.code)
