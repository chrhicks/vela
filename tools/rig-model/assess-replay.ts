import { createReadStream } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { astapVersion } from '@vela/rig-astap'
import { nightOf, pathsIn, scanFrameSources } from '@vela/rig-frames'
import { assess, type Assessment } from '@vela/rig-model'
import { eventsOf, mayConcern } from './am5-events.ts'
import { replayNight, type Solved } from './backfill-replay.ts'
import { nightWindow, overlapping, readRecordings, recordedMount } from './backfill-sources.ts'
import { sha256File, solveCache } from './backfill-solve.ts'

const options = new Map<string, string>()

for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index]
  const value = process.argv[index + 1]

  if (!name?.startsWith('--') || value === undefined) throw new Error('Expected --name value')
  options.set(name.slice(2), value)
}

const report = options.get('report')

if (!report) throw new Error('--report FILE.md is required')

const night = options.get('night') ?? '2026-10-26'

const share = options.get('data') ?? join(homedir(), '.local/share/vela')

const window = nightWindow(night, -240)

const recordings = await readRecordings(options.get('recordings') ?? '/mnt/storage/rig/imports/errai-recordings')

const sources = await scanFrameSources(pathsIn(share, process.env.VELA_RUN_LOG_DIR))

if (sources.problems.length) throw new Error('Frame sources could not all be read')

const images = [
  ...sources.join.joined.map(pair => pair.image),
  ...sources.join.imagesWithoutRecord.predatesRecords,
  ...sources.join.imagesWithoutRecord.unexplained,
].filter(image => image.frameType === 'light' && nightOf(image.capturedAt, -240) === night)

const records = new Map(sources.join.joined.map(pair => [pair.image.id, pair.record]))

const fieldHeight = sources.trials.trials.flatMap(trial => trial.frames)[0]?.fieldHeightDegrees

if (!fieldHeight) throw new Error('No field height in trial inventory')

const version = await astapVersion(join(share, 'astap/astap_cli'))

const cache = solveCache(join(options.get('backfill') ?? '/mnt/storage/rig/backfill', 'solves'), version, fieldHeight)

const solved: Solved[] = []

for (const image of images) {
  const body = await cache.read(await sha256File(image.fitsPath), image)

  if (!body) throw new Error('A light frame has no cached solve; replay never writes the cache')
  solved.push({ capture: { image, record: records.get(image.id) }, body })
}

const gotos: number[] = []

for (const recording of overlapping(recordings, window)) {
  const mount = recording.manifest.devices.find(device => device.kind === 'mount')

  if (!mount) continue

  for await (const line of createInterface({ input: createReadStream(join(recording.path, 'traffic.jsonl')), crlfDelay: Infinity })) {
    if (!mayConcern(line, mount.indiDevice)) continue

    for (const event of eventsOf(line, mount.indiDevice)) {
      if (event.type === 'command' && event.command.kind === 'goto' && event.at >= window.from && event.at < window.to) gotos.push(event.at)
    }
  }
}

const samples: { at: number; assessment: Assessment }[] = []

const resets: string[] = []

let previous: Assessment | undefined

let maxBlind = 0

const result = await replayNight({
  solved,
  mount: recordedMount(recordings, window),
  settleMs: 600_000,
  onStep({ model }, input) {
    const current = assess(model)
    const at = 'seenAt' in input ? input.seenAt : input.at
    maxBlind = Math.max(maxBlind, current.blindTravelDegrees)

    if (current.lastFix?.imageId !== previous?.lastFix?.imageId && current.lastFix) {
      resets.push(`| ${resets.length + 1} | ${(previous?.blindTravelDegrees ?? 0).toFixed(6)} | ${current.blindTravelDegrees.toFixed(6)} | ${current.budgetArcmin.toFixed(3)} |`)
    }

    if (!previous || current.position.state !== previous.position.state || current.blindTravelDegrees !== previous.blindTravelDegrees || current.lastFix?.imageId !== previous.lastFix?.imageId)
      samples.push({ at, assessment: current })
    previous = current
  },
})

const rows = gotos.map((at, index) => {
  const end = gotos[index + 1] ?? window.to
  const slice = samples.filter(sample => sample.at >= at && sample.at < end)
  const states = slice.flatMap((sample, i) => i === 0 || sample.assessment.position.state !== slice[i - 1]?.assessment.position.state ? [sample.assessment.position.state] : [])
  const peak = Math.max(0, ...slice.map(sample => sample.assessment.blindTravelDegrees))

  return `| ${index + 1} | ${states.join(' → ') || 'no state change'} | ${peak.toFixed(6)} |`
})

const text = [
  `# Assess replay ${night}`, '',
  `${result.mountEvents} mount snapshots. ${images.length} cached light-frame results. ${result.model.counters.fixes} joined fixes. ${gotos.length} goto commands.`, '',
  'The replay uses the backfill importer, arrival ordering and reducer. Sources and solve cache are read-only. No hardware or fresh solves.', '',
  'Each goto row runs from its command to the next goto. Early gotos have no saved light-frame solve, so unknown cannot become known. Other motion in that interval can add transitions. No synthetic fixes are inserted.', '',
  '| Goto | State sequence until next goto | Peak blind travel (degrees) |',
  '| --- | --- | --- |', ...rows, '',
  '## Between solves', '',
  'Travel before each accepted fix and immediately after it. Each fix resets the budget to its own pointing residual; movement already observed after the exposure midpoint stays counted.', '',
  '| Fix | Blind travel before (degrees) | After (degrees) | Budget after (arcmin) |',
  '| --- | --- | --- | --- |', ...resets, '',
  `Largest blind travel ${maxBlind.toFixed(6)} degrees.`, '',
  'Snapshot travel is spherical separation, so RA coordinate jumps near a pole are not axis half-turns. Observed operation axis travel takes precedence when larger than the sampled distance. Either route becomes Infinity, meaning unknown travel and an unbounded budget, when a reported change exceeds 54.051625 degrees/s, twice the largest per-sample spherical speed across all recorded motion kinds, including gotos. A valid current-epoch solve restores a finite budget.', '',
  'The 7.02 arcsec per blind degree policy uses step 3\'s p90 reported landing offset as a conservative charge, not an empirical sky-error bound. Confidence budgets are 1.2 arcmin for high and 3 arcmin for low, and are capped by the position state. They allocate 2% and 5% of a one-degree reference field, following the relative alignment and framing needs of step 6. Scale quality remains a separate solve verdict.', '',
].join('\n')

await writeFile(report, text)

console.log(`${result.mountEvents} snapshots, ${images.length} cached results, ${result.model.counters.fixes} fixes, ${gotos.length} gotos; report written`)
