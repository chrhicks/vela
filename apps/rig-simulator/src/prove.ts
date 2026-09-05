/** Opt-in numerical evidence, not part of the default test suite. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { loadCatalog } from './catalog.js'
import { writeFits } from './fits.js'
import { renderSky } from './sky.js'
import { cameraPose, siderealRadiansPerSecond, type MountPosition, type Vector } from './mount.js'

const run = promisify(execFile)
const radians = Math.PI / 180
const catalogPath = process.env.VELA_STAR_CATALOG
const solverPath = process.env.VELA_ASTAP
if (!catalogPath || !solverPath) throw new Error('Set VELA_STAR_CATALOG and VELA_ASTAP; see README.md')
const output = resolve(process.env.VELA_SIM_OUTPUT ?? '.local/proof')
await mkdir(output, { recursive: true })
const stars = await loadCatalog(catalogPath)
const reports = []
for (const [name, altitudeArcsec, azimuthArcsec] of [
  ['large', 480, -360], ['near', 12, -9], ['aligned', 0, 0],
] as const) {
  const points: Vector[] = []
  for (let index = 0; index < 3; index++) {
    const position: MountPosition = {
      latitudeDegrees: 40, altitudeErrorDegrees: altitudeArcsec / 3600,
      azimuthErrorDegrees: azimuthArcsec / 3600, raAxisDegrees: 10 + index * 20,
      declinationDegrees: 60, elapsedSeconds: index * 45, tracking: true,
    }
    const pose = cameraPose(position)
    const path = join(output, `${name}-${index}.fits`)
    const pixels = renderSky(stars, pose, {
      width: 1600, height: 1200, fieldHeightDegrees: 3, seed: index + 42,
    })
    await writeFile(path, writeFits(1600, 1200, pixels))
    const measured = await solve(path, pose.direction)
    // Independently remove Earth rotation; measurements now share t=0 axes.
    const angle = -position.elapsedSeconds * siderealRadiansPerSecond
    points.push([
      measured[0] * Math.cos(angle) - measured[1] * Math.sin(angle),
      measured[0] * Math.sin(angle) + measured[1] * Math.cos(angle), measured[2],
    ])
  }
  const a = subtract(points[1]!, points[0]!)
  const b = subtract(points[2]!, points[0]!)
  let axis: Vector = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const length = Math.hypot(...axis) * (axis[2] < 0 ? -1 : 1)
  axis = [axis[0] / length, axis[1] / length, axis[2] / length]
  const latitude = 40 * radians
  const altitude = Math.asin(axis[0] * Math.cos(latitude) + axis[2] * Math.sin(latitude))
  const azimuth = Math.atan2(axis[1], -axis[0] * Math.sin(latitude) + axis[2] * Math.cos(latitude))
  const measuredAltitude = (altitude / radians - 40) * 3600
  const measuredAzimuth = azimuth / radians * 3600
  const total = Math.atan2(Math.hypot(axis[0], axis[1]), axis[2]) / radians * 3600
  if (Math.abs(measuredAltitude - altitudeArcsec) > 5 || Math.abs(measuredAzimuth - azimuthArcsec) > 5) {
    throw new Error(`${name}: recovered axis exceeds the 5 arcsec synthetic component tolerance`)
  }
  const report = { name, altitudeArcsec, azimuthArcsec, measuredAltitude, measuredAzimuth, total }
  reports.push(report)
  console.log(report)
}
// A failed exposure must exercise the solver, not inject a solved=false shortcut.
const obscuredPath = join(output, 'obscured.fits')
const pose = cameraPose({ latitudeDegrees: 40, altitudeErrorDegrees: 0,
  azimuthErrorDegrees: 0, raAxisDegrees: 30, declinationDegrees: 60,
  elapsedSeconds: 0, tracking: true })
await writeFile(obscuredPath, writeFits(1600, 1200, renderSky(stars, pose, {
  width: 1600, height: 1200, fieldHeightDegrees: 3, seed: 99, obscured: true,
})))
const obscured = await invokeSolver(obscuredPath, pose.direction)
if (obscured.code !== 1 || !obscured.stdout.includes('No solution found')) {
  throw new Error('Expected a genuine no-solution result for obscured sky')
}
await writeFile(join(output, 'results.json'), JSON.stringify({ reports, obscured: 'no solution' }, null, 2))
console.log(`Proof passed. Images, solver outputs and results: ${output}`)

async function solve(path: string, hint: Vector): Promise<Vector> {
  const result = await invokeSolver(path, hint)
  if (result.code !== 0) throw new Error(`ASTAP failed: ${result.stdout}`)
  const values = Object.fromEntries((await readFile(path.replace(/\.fits$/, '.ini'), 'utf8'))
    .split(/\r?\n/).filter(line => line.includes('=')).map(line => {
      const index = line.indexOf('=')
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()]
    }))
  if (values.PLTSOLVD !== 'T' || Number(values.CRPIX1) !== 800.5 || Number(values.CRPIX2) !== 600.5) {
    throw new Error('Solver output does not describe the expected optical center')
  }
  const ra = Number(values.CRVAL1) * radians
  const dec = Number(values.CRVAL2) * radians
  if (!Number.isFinite(ra) || !Number.isFinite(dec) || Math.abs(dec) > Math.PI / 2) {
    throw new Error('Invalid solver coordinates')
  }
  return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)]
}

async function invokeSolver(path: string, hint: Vector) {
  const ra = (Math.atan2(hint[1], hint[0]) / radians + 360) % 360
  const dec = Math.asin(hint[2]) / radians
  const args = ['-f', path, '-d', resolve(catalogPath!), '-fov', '3',
    '-ra', String(ra / 15 + 0.05), '-spd', String(dec + 90.3), '-r', '5']
  try {
    const result = await run(resolve(solverPath!), args, { timeout: 30_000 })
    await writeFile(path.replace(/\.fits$/, '.log'), result.stdout + result.stderr)
    return { code: 0, stdout: result.stdout }
  } catch (error) {
    const failure = error as { code?: number | string, stdout?: string, stderr?: string }
    if (typeof failure.code !== 'number') throw error
    await writeFile(path.replace(/\.fits$/, '.log'), (failure.stdout ?? '') + (failure.stderr ?? ''))
    return { code: failure.code, stdout: failure.stdout ?? '' }
  }
}

function subtract(a: Vector, b: Vector): Vector {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
