import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { rigidityVerdict, type Baseline, type BaselinePosition } from '@vela/rig-sky'

const usage = `usage: rigidity-check.ts [--tool DIR] [--report FILE.md]
exit 0 the plan's check holds, 1 it does not, 2 bad arguments`

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

const toolDirectory = given.get('tool') ?? '/home/chicks/dev/personal/home/bots/observer/tools/mount-rigidity'

const fixturesDirectory = join(toolDirectory, 'tests', 'fixtures')

const agreementArcmin = 1e-6

const recordedToleranceArcmin = 0.3

/** Alignments that finished at a few tenths of an arcmin on 2026-10-31 while the mount was loose. */
const readSmallOnTheNight = new Map([
  ['24390f55', 'finished at 0.2 arcmin'],
  ['6f2a08e0', 'finished at 0.14 arcmin'],
])

interface FixtureRow {
  readonly trial: string
  readonly baseline: Baseline
}

interface PythonRow {
  readonly trial: string
  readonly miss: number
  readonly verdict: string
  readonly recorded: number
}

type Column = readonly [number, number, number]

interface FixtureFile {
  readonly schema: number
  readonly kind: string
  readonly name: string
  readonly observations: readonly { readonly theta_deg: number; readonly F: readonly Column[] }[]
}

function position(observation: FixtureFile['observations'][number]): BaselinePosition {
  const column = (index: number): Column => [observation.F[0]![index]!, observation.F[1]![index]!, observation.F[2]![index]!]

  return { mountAngleDegrees: observation.theta_deg, orientation: { pixelX: column(0), pixelY: column(1), boresight: column(2) } }
}

function readFixture(file: string): FixtureRow {
  // SAFETY: a baseline fixture holds exactly this shape (mount-rigidity `model.load_fixture`, schema 1); the check below rejects anything else.
  const fixture = JSON.parse(readFileSync(join(fixturesDirectory, file), 'utf8')) as FixtureFile
  const [first, second, third] = fixture.observations

  if (fixture.schema !== 1 || fixture.kind !== 'baseline' || first === undefined || second === undefined || third === undefined)
    throw new Error(`${file} is not a schema 1 baseline of three positions`)

  return { trial: fixture.name, baseline: [position(first), position(second), position(third)] }
}

const pythonProgram = `
import json, sys
sys.dont_write_bytecode = True
sys.path[:0] = ['.', 'tests']
from mount_rigidity.cli import _verdict
from mount_rigidity.model import load_fixture
from mount_rigidity.rigidity import baseline_report
from test_rigidity import TRIALS
rows = []
for path in sys.argv[1:]:
    _, series, _ = load_fixture(path)
    miss = baseline_report(series.observations).pos3_miss_arcmin
    rows.append({'trial': series.name, 'miss': miss, 'verdict': _verdict(miss), 'recorded': TRIALS[series.name][0]})
print(json.dumps(rows))
`

const files = readdirSync(fixturesDirectory).filter(file => /^trial-.*\.json$/.test(file)).sort()

const fixtures = files.map(readFixture)

// SAFETY: the program above prints exactly this JSON.
const python = JSON.parse(
  execFileSync('python3', ['-I', '-c', pythonProgram, ...files.map(file => join(fixturesDirectory, file))], { cwd: toolDirectory, encoding: 'utf8' }),
) as PythonRow[]

const rows = fixtures.map(({ trial, baseline }) => {
  const reference = python.find(row => row.trial === trial)

  if (reference === undefined) throw new Error(`The Python tool printed nothing for trial ${trial}`)

  const verdict = rigidityVerdict(baseline)

  return {
    trial,
    reference,
    verdict,
    difference: verdict.missArcmin - reference.miss,
    verdictsAgree: (verdict.status === 'rigid') === (reference.verdict === 'rigid'),
    note: readSmallOnTheNight.get(trial),
  }
})

const largestDifference = Math.max(...rows.map(row => Math.abs(row.difference)))

const failures = [
  ...rows.filter(row => Math.abs(row.difference) > agreementArcmin).map(row => `${row.trial}: TS and Python misses differ by ${row.difference}`),
  ...rows.filter(row => !row.verdictsAgree).map(row => `${row.trial}: TS says ${row.verdict.status}, Python says ${row.reference.verdict}`),
  ...rows
    .filter(row => Math.abs(row.verdict.missArcmin - row.reference.recorded) > recordedToleranceArcmin)
    .map(row => `${row.trial}: TS miss ${row.verdict.missArcmin.toFixed(2)} is not the recorded ${row.reference.recorded}`),
  ...rows.filter(row => row.note !== undefined && row.verdict.status !== 'not-rigid').map(row => `${row.trial}: ${row.note} but TS says rigid`),
]

if (fixtures.length !== 19) failures.push(`expected 19 trial fixtures, found ${fixtures.length}`)

const table = rows.map(
  row =>
    `| ${row.trial} | ${row.reference.recorded.toFixed(1)} | ${row.reference.miss.toFixed(4)} | ${row.verdict.missArcmin.toFixed(4)} | ${row.difference.toExponential(1)} | ${row.verdict.status} | ${row.reference.verdict} | ${row.note ?? ''} |`,
)

const report = [
  '# Rigidity verdict against the Python mount-rigidity tool',
  '',
  `${rows.length} recorded baselines. Misses are the third-position miss in arcminutes. The threshold is ${rows[0]?.verdict.thresholdArcmin} arcmin: below it is rigid, at or above it is not rigid. The Python tool also calls 2 to 10 arcmin "marginal" and 10 or more "LOOSE"; both are not rigid here.`,
  '',
  '| Trial | Recorded | Python | TS | TS minus Python | TS verdict | Python verdict | On 2026-10-31 |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ...table,
  '',
  `Largest difference between TS and Python: ${largestDifference.toExponential(2)} arcmin (tolerance ${agreementArcmin} arcmin). TS against the recorded misses: tolerance ${recordedToleranceArcmin} arcmin, as in the Python tool's test.`,
  `Verdicts: ${rows.filter(row => row.verdict.status === 'rigid').length} rigid, ${rows.filter(row => row.verdict.status === 'not-rigid').length} not rigid. ${rows.filter(row => !row.verdictsAgree).length} disagree with the Python tool.`,
  failures.length === 0 ? 'Check: pass.' : `Check: FAIL\n${failures.map(failure => `- ${failure}`).join('\n')}`,
  '',
].join('\n')

console.log(report)

const reportFile = given.get('report')

if (reportFile !== undefined) writeFileSync(reportFile, report)

process.exit(failures.length === 0 ? 0 : 1)
