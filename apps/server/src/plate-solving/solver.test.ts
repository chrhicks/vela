import { mkdtemp, writeFile, readFile, readdir, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createAstapSolver, projectSky } from './solver.js'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
const frame = { width: 2, height: 2, pixels: [0, 65535, 123, 20], capturedAt: '2026-09-05T01:00:00Z' }
const hint = { raDegrees: 30, decDegrees: 60 }
const ini = 'PLTSOLVD=T\nCRPIX1=1.5\nCRPIX2=1.5\nCRVAL1=30\nCRVAL2=60\nCD1_1=0.01\nCD1_2=0\nCD2_1=0\nCD2_2=-0.01\n'
async function fixture(body: string, timeoutMs = 3000) {
  const root = await mkdtemp(join(tmpdir(), 'vela-solver-test-'))
  directories.push(root)
  const executable = join(root, 'astap')
  const marker = join(root, 'input-path')
  const script = `#!${process.execPath}\nconst fs = require('node:fs')\nconst path = process.argv[process.argv.indexOf('-f') + 1]\nfs.writeFileSync(${JSON.stringify(marker)}, path)\n${body}\n`
  await writeFile(executable, script, { mode: 0o755 })
  return { root, marker, solver: createAstapSolver({ executable, catalogPath: root, fieldHeightDegrees: 3, timeoutMs }) }
}

it('sends raw signed-32 FITS, normalizes a solved center and removes per-exposure artifacts', async () => {
  const fixtureData = await fixture(`const image = fs.readFileSync(path)
if (!image.subarray(0,2880).toString().includes('BITPIX  =                   32') || image.readInt32BE(2884) !== 65535) process.exit(16)
fs.writeFileSync(path.replace('.fits','.ini'), ${JSON.stringify(ini)})`)
  const solution = await fixtureData.solver.solve(frame, hint, new AbortController().signal)
  expect(solution.status).toBe('solved')
  if (solution.status !== 'solved') throw new Error('Expected solution')
  expect(solution.raDegrees).toBe(30)
  expect(solution.wcs).not.toHaveProperty('pixels')
  expect(solution.capturedAt).toBe(frame.capturedAt)
  expect(projectSky(solution.wcs, hint)).toEqual({ x: 0.5, y: 0.5 })
  expect(projectSky(solution.wcs, { raDegrees: 30, decDegrees: 60.01 })!.y).toBeCloseTo(-0.5, 5)
  expect(projectSky(solution.wcs, { raDegrees: 210, decDegrees: -60 })).toBeNull()
  const input = await readFile(fixtureData.marker, 'utf8')
  await expect(access(dirname(input))).rejects.toThrow()
})

it('treats only documented no-match exits as retryable, not missing databases or invalid success output', async () => {
  for (const exitCode of [1, 2, 32]) {
    const { solver } = await fixture(`process.exit(${exitCode})`)
    const result = solver.solve(frame, hint, new AbortController().signal)
    if (exitCode === 32) await expect(result).rejects.toThrow('exit code 32')
    else await expect(result).resolves.toEqual({ status: 'no-solution' })
  }
  const { solver } = await fixture(`fs.writeFileSync(path.replace('.fits','.ini'), ${JSON.stringify(ini.replace('CRVAL1=30', 'CRVAL1='))})`)
  await expect(solver.solve(frame, hint, new AbortController().signal)).rejects.toThrow('CRVAL1')
})

it('cancels a running solver and removes its scratch directory after process termination', async () => {
  const { solver, marker } = await fixture('setInterval(() => {}, 1000)')
  const controller = new AbortController()
  const result = solver.solve(frame, hint, controller.signal)
  const rejected = expect(result).rejects.toThrow('operator stopped')
  await vi.waitFor(async () => { expect(await readFile(marker, 'utf8')).toContain('exposure.fits') })
  controller.abort(new Error('operator stopped'))
  await rejected
  await expect(readdir(dirname(await readFile(marker, 'utf8')))).rejects.toThrow()
})

it('bounds a hung executable and rejects bad frames before spawning it', async () => {
  const { solver, marker } = await fixture('setInterval(() => {}, 1000)', 100)
  await expect(solver.solve({ ...frame, pixels: [1] }, hint, new AbortController().signal)).rejects.toThrow('image dimensions')
  await expect(access(marker)).rejects.toThrow()
  await expect(solver.solve(frame, hint, new AbortController().signal)).rejects.toThrow('timed out')
  await expect(access(dirname(await readFile(marker, 'utf8')))).rejects.toThrow()
})

it('preserves negative acquisition samples and tells ASTAP to check a Bayer exposure', async () => {
  const { solver } = await fixture(`const image = fs.readFileSync(path)
if (image.readInt32BE(2880) !== -40 || !image.subarray(0,2880).toString().includes("'GBRG'") || process.argv[process.argv.indexOf('-check') + 1] !== 'y') process.exit(16)
fs.writeFileSync(path.replace('.fits','.ini'), ${JSON.stringify(ini)})`)
  await expect(solver.solve({ ...frame, pixels: [-40, 65535, 1, 2], color: { kind: 'bayer', pattern: 'gbrg' } }, hint, new AbortController().signal)).resolves.toMatchObject({ status: 'solved' })
})
