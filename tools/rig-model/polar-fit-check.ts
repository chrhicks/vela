import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fitPolarAxis, type SweepFix } from '@vela/rig-sky'
import { syntheticSite } from '@vela/rig-testing'

const usage = `usage: polar-fit-check.ts [--tool DIR] [--report FILE.md]
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

const expectedSteps = new Map<string, readonly { readonly labelAfter: string; readonly excessArcmin?: number }[]>([
  ['sweep-dec80-before-fix', [{ labelAfter: 'sw2-f1-p5' }, { labelAfter: 'sw2-b-p3' }, { labelAfter: 'sw2-f2-p4' }]],
  ['scan-dec80-fine-before-fix', [{ labelAfter: 'fn1-8', excessArcmin: 45 }]],
  ['scan-dec70-before-fix', [{ labelAfter: 'dc70-6', excessArcmin: 36 }]],
  ['scan-dec70-after-fix', []],
])

const statedSizeToleranceArcmin = 1

type Column = readonly [number, number, number]

interface FixtureFile {
  readonly schema: number
  readonly kind: string
  readonly name: string
  readonly observations: readonly {
    readonly label: string
    readonly t_s: number
    readonly theta_deg: number
    readonly F: readonly Column[]
  }[]
}

interface PythonStep {
  readonly before: string
  readonly after: string
  readonly excess: number
  readonly baseline: number
}

interface PythonRow {
  readonly name: string
  readonly steps: readonly PythonStep[]
  readonly axis: readonly [number, number, number]
  readonly altitudeArcmin: number
  readonly azimuthArcmin: number
  readonly totalArcmin: number
  readonly miss: number
}

function readFixture(file: string) {
  // SAFETY: a sweep or scan fixture holds exactly this shape (mount-rigidity `model.load_fixture`, schema 1); the check below rejects anything else.
  const fixture = JSON.parse(readFileSync(join(fixturesDirectory, file), 'utf8')) as FixtureFile

  if (fixture.schema !== 1 || fixture.kind !== 'sweep') throw new Error(`${file} is not a schema 1 sweep`)

  const fixes = fixture.observations.map((observation): SweepFix => {
    const column = (index: number): Column => [observation.F[0]![index]!, observation.F[1]![index]!, observation.F[2]![index]!]

    return {
      label: observation.label,
      atSeconds: observation.t_s,
      mountAngleDegrees: observation.theta_deg,
      orientation: { pixelX: column(0), pixelY: column(1), boresight: column(2) },
    }
  })

  return { name: fixture.name, fixes }
}

/** Python's axis is the mean of `pair_table`'s pair axes, weighted as the TS fit weights them; its miss is the worst `baseline_report` miss from the widest pair. */
const pythonProgram = `
import json, math, sys
sys.dont_write_bytecode = True
sys.path[:0] = ['.']
import numpy as np
from mount_rigidity.model import load_fixture
from mount_rigidity.physics import axis_errors
from mount_rigidity.rigidity import baseline_report, find_steps, pair_table
from mount_rigidity.rotation import wrap180
latitude = float(sys.argv[1])
rows = []
for path in sys.argv[2:]:
    _, series, _ = load_fixture(path)
    total = np.zeros(3)
    for row in pair_table(series, 0, 180):
        tilt, direction = math.radians(row.tilt_arcmin / 60), math.radians(row.direction_deg)
        weight = math.sin(math.radians(row.solved_turn_deg) / 2) ** 2
        total += weight * np.array([math.sin(tilt) * math.cos(direction), math.sin(tilt) * math.sin(direction), math.cos(tilt)])
    axis = total / np.linalg.norm(total)
    altitude, azimuth, total_error = axis_errors(axis, latitude)
    obs = series.sorted()
    pairs = [(abs(wrap180(b.theta_deg - a.theta_deg)), i, j) for i, a in enumerate(obs) for j, b in enumerate(obs) if i < j]
    _, i, j = max(pairs, key=lambda pair: pair[0])
    miss = max(baseline_report((obs[i], obs[j], c)).pos3_miss_arcmin for k, c in enumerate(obs) if k not in (i, j))
    steps = [{'before': s.label_before, 'after': s.label_after, 'excess': s.excess_arcmin, 'baseline': s.baseline_arcmin} for s in find_steps(series)]
    rows.append({'name': series.name, 'steps': steps, 'axis': list(axis), 'altitudeArcmin': altitude, 'azimuthArcmin': azimuth, 'totalArcmin': total_error, 'miss': miss})
print(json.dumps(rows))
`

const files = readdirSync(fixturesDirectory)
  .filter(file => /^(sweep|scan)-.*\.json$/.test(file))
  .sort()

const fixtures = files.map(readFixture)

// SAFETY: the program above prints exactly this JSON.
const python = JSON.parse(
  execFileSync('python3', ['-I', '-c', pythonProgram, String(syntheticSite.latitudeDegrees), ...files.map(file => join(fixturesDirectory, file))], {
    cwd: toolDirectory,
    encoding: 'utf8',
  }),
) as PythonRow[]

/** From atan2, since the cosine cannot resolve a separation of a millionth of an arcmin. */
function arcminutesBetween(a: readonly number[], b: readonly number[]) {
  const cross = [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!]

  return Math.atan2(Math.hypot(...cross), a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!) * (180 / Math.PI) * 60
}

const tiltOf = (axis: readonly number[]) => ({
  tilt: arcminutesBetween(axis, [0, 0, 1]),
  direction: (Math.atan2(axis[1]!, axis[0]!) * 180) / Math.PI,
})

const failures: string[] = []

const rows = fixtures.map(({ name, fixes }) => {
  const reference = python.find(row => row.name === name)

  if (reference === undefined) throw new Error(`The Python tool printed nothing for ${name}`)

  const fit = fitPolarAxis(fixes, syntheticSite.latitudeDegrees)
  const expected = expectedSteps.get(name)
  const steps = fit.verdict.steps

  if (expected === undefined) failures.push(`${name}: the recorded poses of its steps are not listed in expectedSteps`)

  if (expected !== undefined) {
    const found = steps.map(step => step.labelAfter).join(', ')
    const wanted = expected.map(step => step.labelAfter).join(', ')

    if (found !== wanted) failures.push(`${name}: TS finds steps at [${found}], the Python tool's tests say [${wanted}]`)

    expected.forEach((want, index) => {
      const got = steps[index]

      if (want.excessArcmin !== undefined && got !== undefined && Math.abs(got.excessArcmin - want.excessArcmin) > statedSizeToleranceArcmin)
        failures.push(`${name}: the step at ${got.labelAfter} is ${got.excessArcmin.toFixed(1)} arcmin, the Python tool's tests say ${want.excessArcmin}`)
    })

    const wantsRigid = expected.length === 0

    if ((fit.verdict.status === 'rigid') !== wantsRigid) failures.push(`${name}: TS says ${fit.verdict.status}, but the sweep ${wantsRigid ? 'has no step' : 'has steps'}`)
  }

  const foundPairs = steps.map(step => `${step.labelBefore}>${step.labelAfter}`).join(', ')
  const pythonPairs = reference.steps.map(step => `${step.before}>${step.after}`).join(', ')

  if (foundPairs !== pythonPairs) failures.push(`${name}: TS steps [${foundPairs}] and Python steps [${pythonPairs}] differ`)

  const stepDifference = Math.max(
    0,
    ...steps.flatMap((step, index) => {
      const other = reference.steps[index]

      return other === undefined ? [] : [Math.abs(step.excessArcmin - other.excess), Math.abs(step.baselineArcmin - other.baseline)]
    }),
  )

  const axisDifference = arcminutesBetween(fit.axis, reference.axis)

  const angleDifference = Math.max(
    Math.abs(fit.altitudeArcsec / 60 - reference.altitudeArcmin),
    Math.abs(fit.azimuthArcsec / 60 - reference.azimuthArcmin),
    Math.abs(fit.totalArcsec / 60 - reference.totalArcmin),
  )

  const missDifference = Math.abs(fit.verdict.missArcmin - reference.miss)

  for (const [what, difference] of [['step size', stepDifference], ['axis', axisDifference], ['altitude, azimuth or total', angleDifference], ['worst miss', missDifference]] as const) {
    if (!(difference <= agreementArcmin)) failures.push(`${name}: TS and Python differ by ${difference} arcmin in ${what}`)
  }

  return { name, count: fixes.length, fit, reference, stepDifference, axisDifference, angleDifference, missDifference }
})

if (rows.length !== 4) failures.push(`expected 4 sweep and scan fixtures, found ${rows.length}`)

const fixed = (value: number, digits: number) => value.toFixed(digits)

const stepRows = rows.flatMap(({ name, fit, reference }) =>
  fit.verdict.steps.map((step, index) => {
    const other = reference.steps[index]

    return `| ${name} | ${step.labelBefore} to ${step.labelAfter} | ${fixed(step.mountAngleBeforeDegrees, 1)} to ${fixed(step.mountAngleAfterDegrees, 1)} | ${fixed(step.turnDegrees, 2)} | ${fixed(step.excessArcmin, 1)} | ${other === undefined ? '' : fixed(other.excess, 1)} | ${fixed(step.baselineArcmin, 1)} |`
  }),
)

const verdictRows = rows.map(({ name, count, fit, reference }) => {
  const poses = (labels: readonly string[]) => (labels.length === 0 ? 'none' : labels.join(', '))

  return `| ${name} | ${count} | ${poses((expectedSteps.get(name) ?? []).map(step => step.labelAfter))} | ${poses(fit.verdict.steps.map(step => step.labelAfter))} | ${poses(reference.steps.map(step => step.after))} | ${fit.verdict.status} | ${fixed(fit.verdict.missArcmin, 2)} | ${fixed(reference.miss, 2)} |`
})

const axisRows = rows.map(({ name, fit, reference, axisDifference, angleDifference, stepDifference, missDifference }) => {
  const ours = tiltOf(fit.axis)
  const theirs = tiltOf(reference.axis)

  return `| ${name} | ${fixed(ours.tilt, 3)} | ${fixed(ours.direction, 2)} | ${fixed(theirs.tilt, 3)} | ${fixed(theirs.direction, 2)} | ${axisDifference.toExponential(1)} | ${angleDifference.toExponential(1)} | ${stepDifference.toExponential(1)} | ${missDifference.toExponential(1)} |`
})

const report = [
  '# Polar axis fit against the Python mount-rigidity tool',
  '',
  `${rows.length} recorded sweeps and scans, read at run time from the Python tool's fixtures. Each is fitted by \`fitPolarAxis\` and by the Python tool on the same file. Sizes are arcminutes of excess camera rotation beyond the mount's turn. The step floor is 8 arcmin over 1.5 times what the sweep's own tilt adds. Agreement tolerance: ${agreementArcmin} arcmin.`,
  '',
  '## Steps and verdict',
  '',
  '| Fixture | Fixes | Steps the Python tests expect | TS steps | Python steps | TS verdict | TS worst miss, arcmin | Python worst miss, arcmin |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ...verdictRows,
  '',
  '## Each step',
  '',
  '| Fixture | Poses either side | Mount angle either side, degrees | Turn, degrees | TS excess | Python excess | Tilt baseline |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  ...stepRows,
  '',
  '## Fitted axis',
  '',
  `Tilt is the angle from the pole in arcmin and direction is the way the axis leans in the hour-angle frame, so no site enters. The altitude, azimuth and total are compared at the synthetic site (latitude ${syntheticSite.latitudeDegrees}), where only the shared arithmetic is tested. Differences are the largest over the axis, those three angles, every step size and baseline, and the worst miss; all in arcmin.`,
  '',
  '| Fixture | TS tilt | TS direction | Python tilt | Python direction | Axis difference | Angle difference | Step difference | Miss difference |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...axisRows,
  '',
  failures.length === 0 ? 'Check: pass.' : `Check: FAIL\n${failures.map(failure => `- ${failure}`).join('\n')}`,
  '',
].join('\n')

console.log(report)

const reportFile = given.get('report')

if (reportFile !== undefined) writeFileSync(reportFile, report)

process.exit(failures.length === 0 ? 0 : 1)
