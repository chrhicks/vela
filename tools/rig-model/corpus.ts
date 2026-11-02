import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { astapVersion, readFits } from '@vela/rig-astap'
import { imageId } from '@vela/rig-events'
import { pathsIn, scanFrameSources } from '@vela/rig-frames'
import { caseResults, inventoryOf, specimens, type Solve } from './corpus-inventory.ts'
import { reportOf } from './corpus-report.ts'
import { inParallel, sha256File, solveCache, solveImage } from './backfill-solve.ts'

const usage = `usage: corpus.ts [--out DIR] [--backfill DIR] [--report FILE.md] [--data DIR] [--utc-offset-minutes N] [--audit-until INSTANT]
  [--astap FILE] [--catalog DIR] [--field-height-degrees N] [--jobs N] [--timeout-ms N]
exit 0 complete, 1 failed, 2 bad arguments`

const given = new Map<string, string>()

for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index]
  const value = process.argv[index + 1]

  if (!name?.startsWith('--') || value === undefined) {
    console.error(usage)
    process.exit(2)
  }

  given.set(name.slice(2), value)
}

const share = join(homedir(), '.local/share/vela')

const outDirectory = given.get('out') ?? '/mnt/storage/rig/corpus'

const backfillDirectory = given.get('backfill') ?? '/mnt/storage/rig/backfill'

const utcOffsetMinutes = Number(given.get('utc-offset-minutes') ?? '0')

const auditUntil = given.get('audit-until') ?? '9999-12-31T00:00:00Z'

const sources = await scanFrameSources(pathsIn(given.get('data') ?? process.env.VELA_DATA_DIR ?? share, process.env.VELA_RUN_LOG_DIR))

if (sources.problems.length > 0) {
  console.error(`failed: ${sources.problems.length} frame sources could not be read, the first ${sources.problems[0]?.reason}`)
  process.exit(1)
}

const executable = given.get('astap') ?? join(share, 'astap/astap_cli')

const fieldHeightDegrees = Number(given.get('field-height-degrees') ?? sources.trials.trials.flatMap(trial => trial.frames)[0]?.fieldHeightDegrees)

if (!(fieldHeightDegrees > 0)) {
  console.error('no --field-height-degrees, and no alignment trial to take it from')
  process.exit(2)
}

const solver = {
  executable,
  catalogPath: given.get('catalog') ?? join(share, 'astap/catalog/opt/astap'),
  fieldHeightDegrees,
  solverVersion: await astapVersion(executable),
  timeoutMs: Number(given.get('timeout-ms') ?? '60000'),
}

const jobs = Number(given.get('jobs') ?? '4')

const caches = [solveCache(join(backfillDirectory, 'solves'), solver.solverVersion, fieldHeightDegrees), solveCache(join(outDirectory, 'solves'), solver.solverVersion, fieldHeightDegrees)]

/** The solver wants an image id for its request. The corpus names no image by it, and `withoutId` drops it. */
const unnamed = { id: imageId('00000000-0000-4000-8000-000000000000') }

async function cached(sha256: string): Promise<Solve | undefined> {
  for (const cache of caches) {
    const body = await cache.read(sha256, unnamed)

    if (body !== undefined) return withoutId(body)
  }

  return undefined
}

function withoutId(body: Awaited<ReturnType<typeof solveImage>>): Solve {
  const { imageId: _named, ...solve } = body

  return solve
}

const lights = sources.savedImages.images.filter(image => image.frameType === 'light')

const kept = sources.trials.trials.flatMap(trial => trial.frames.filter(frame => frame.onDisk).map(frame => ({ frame, path: join(trial.directory, frame.filename) })))

const syntheticDirectory = join(outDirectory, 'synthetic')

const synthetic = specimens.flatMap(specimen => (specimen.file !== null && existsSync(join(syntheticDirectory, specimen.file)) ? [join(syntheticDirectory, specimen.file)] : []))

const paths = [...lights.map(image => image.fitsPath), ...kept.map(item => item.path), ...synthetic]

const hashes = await inParallel(paths, 8, path => sha256File(path))

const digests = new Map(paths.map((path, index) => [path, hashes[index]!]))

const solves = new Map<string, Solve>()

for (const image of lights) {
  const sha256 = digests.get(image.fitsPath)!
  const solve = await cached(sha256)

  if (solve !== undefined) solves.set(sha256, solve)
}

const execute = promisify(execFile)

/**
 * The stars ASTAP finds in a frame: the first number of its log line `N stars, M quads selected`. It is found before any
 * match, so a search radius of 10 degrees is enough. A Bayer frame gets `-check y` as the solver gives it, which changes the count.
 */
async function starsIn(path: string, hint: { raDegrees: number; decDegrees: number }): Promise<number | undefined> {
  const directory = await mkdtemp(join(tmpdir(), 'rig-corpus-'))

  try {
    const copy = join(directory, 'exposure.fits')

    const read = readFits(await readFile(path))

    await symlink(path, copy)
    await execute(executable, ['-f', copy, '-d', solver.catalogPath, '-fov', String(fieldHeightDegrees), '-ra', String(hint.raDegrees / 15), '-spd', String(hint.decDegrees + 90), '-r', '10', '-s', '1000', ...(read.ok && read.frame.color.kind === 'bayer' ? ['-check', 'y'] : []), '-log'], { timeout: solver.timeoutMs }).catch(() => undefined)

    const log = await readFile(join(directory, 'exposure.log'), 'utf8').catch(() => '')

    const found = /(\d+) stars, \d+ quads selected in the image/.exec(log)?.[1]

    return found === undefined ? undefined : Number(found)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

const stars = new Map<string, number>()

let solvedNow = 0

await inParallel(kept, jobs, async ({ frame, path }) => {
  const sha256 = digests.get(path)!

  if (sha256 !== frame.sha256) return

  const count = await starsIn(path, frame.hint)

  if (count !== undefined) stars.set(sha256, count)

  const known = await cached(sha256)

  if (known !== undefined) return void solves.set(sha256, known)

  const body = await solveImage(solver, { ...unnamed, fitsPath: path }, frame.hint)

  await caches[1]!.write(sha256, body)

  solves.set(sha256, withoutId(body))

  solvedNow++
})

const entries = inventoryOf({ trials: sources.trials.trials, images: lights, digests, solves, stars, utcOffsetMinutes, synthetic: syntheticDirectory })

async function replace(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(`${path}.tmp`, content)
  await rename(`${path}.tmp`, path)
}

await replace(join(outDirectory, 'corpus.json'), JSON.stringify({ solverVersion: solver.solverVersion, fieldHeightDegrees, cases: caseResults(entries), entries }, null, 1) + '\n')

await replace(given.get('report') ?? join(outDirectory, 'report.md'), reportOf(entries, { solverVersion: solver.solverVersion, auditUntil }))

console.log(`${entries.length} entries; ${solvedNow} frames solved now, the rest read from the cache`)

for (const result of caseResults(entries)) console.log(`${result.id}  ${result.status}  ${result.entries} entries, ${result.withPixels} with pixels, ${result.lacking} lacking`)
