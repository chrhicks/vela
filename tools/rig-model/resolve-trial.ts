import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { astapVersion, createAstapSolver, readFits, solveFrame } from '@vela/rig-astap'
import { imageId } from '@vela/rig-events'
import { angularDistance } from '@vela/rig-sky'

const share = join(homedir(), '.local/share/vela')

function option(name: string, fallback: string): string {
  const at = process.argv.indexOf(name)

  return at === -1 ? fallback : (process.argv[at + 1] ?? fallback)
}

const trialsRoot = join(share, 'alignment-diagnostics/trials')

const trialPrefix = option('--trial', '2bfbf00c')

const trial = readdirSync(trialsRoot).find(name => name.startsWith(trialPrefix))

const toleranceArcsec = Number(option('--tolerance-arcsec', '2'))

const executable = option('--astap', join(share, 'astap/astap_cli'))

const catalogPath = option('--catalog', join(share, 'astap/catalog/opt/astap'))

if (trial === undefined) {
  console.error(`resolve-trial: no trial starting with ${trialPrefix} under ${trialsRoot}`)
  process.exit(2)
}

interface Recorded {
  readonly original: { readonly filename: string; readonly sha256: string }
  readonly evidence: {
    readonly phase: string
    readonly fieldHeightDegrees: number
    readonly hint: { readonly raDegrees: number; readonly decDegrees: number }
    readonly solution: { readonly status: string; readonly raDegrees: number; readonly decDegrees: number; readonly wcs: { readonly cd: readonly number[] } }
  }
}

const directory = join(trialsRoot, trial)

const baselines = readFileSync(join(directory, 'journal.jsonl'), 'utf8')
  .split('\n')
  .filter(line => line.trim() !== '')
  .map(line => JSON.parse(line))
  .filter(line => line.type === 'frame' && line.evidence?.phase === 'baseline')
  .map((line): Recorded => line)

const version = await astapVersion(executable)

const scale = (cd: readonly number[]) => Math.sqrt(Math.abs((cd[0] ?? 0) * (cd[3] ?? 0) - (cd[1] ?? 0) * (cd[2] ?? 0))) * 3600

let failed = baselines.length === 0

for (const [index, recorded] of baselines.entries()) {
  const bytes = readFileSync(join(directory, recorded.original.filename))
  const digest = createHash('sha256').update(bytes).digest('hex') === recorded.original.sha256
  const read = readFits(bytes)

  if (!read.ok) {
    console.log(`baseline ${index + 1}: cannot read the FITS (${read.reason})`)
    failed = true
    continue
  }

  const solver = createAstapSolver({ executable, catalogPath, fieldHeightDegrees: recorded.evidence.fieldHeightDegrees })
  const body = await solveFrame(solver, { imageId: imageId(/-([0-9a-f-]{36})\.fits$/.exec(recorded.original.filename)?.[1] ?? ''), hint: recorded.evidence.hint, solverVersion: version }, read.frame, AbortSignal.timeout(60_000))

  if (body.status !== 'solved') {
    console.log(`baseline ${index + 1}: pixels ${digest ? 'match the recorded digest' : 'DIFFER from the recorded digest'}; no solution (${body.reason})`)
    failed = true
    continue
  }

  const separation = angularDistance(body.centre, recorded.evidence.solution) * 3600
  const ratio = scale(body.wcs.cd) / scale(recorded.evidence.solution.wcs.cd)
  const ok = digest && separation <= toleranceArcsec && Math.abs(ratio - 1) < 1e-3
  failed ||= !ok

  console.log(
    `baseline ${index + 1}: ${ok ? 'MATCH' : 'MISMATCH'} the recorded solve, centre ${separation.toFixed(3)} arcsec apart, plate scale ratio ${ratio.toFixed(6)}, ` +
      `searched to ${body.hint?.radiusDegrees} deg, ${body.solveMs} ms, pixels ${digest ? 'match the recorded sha256' : 'DIFFER from the recorded sha256'}`,
  )
}

console.log(`${version}, trial ${trial.slice(0, 8)}, ${baselines.length} baseline frames, tolerance ${toleranceArcsec} arcsec`)

process.exit(failed ? 1 : 0)
