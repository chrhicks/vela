import { mkdtemp, writeFile, readFile, readdir, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { trace, context } from '@opentelemetry/api'
import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node'
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
  const attempts = join(root, 'attempts.jsonl')
  const script = `#!${process.execPath}\nconst fs = require('node:fs')\nconst path = process.argv[process.argv.indexOf('-f') + 1]\nfs.writeFileSync(${JSON.stringify(marker)}, path)\nfs.appendFileSync(${JSON.stringify(attempts)}, JSON.stringify({ path, args: process.argv.slice(2), hash: require('node:crypto').createHash('sha256').update(fs.readFileSync(path)).digest('hex') }) + '\\n')\n${body}\n`
  await writeFile(executable, script, { mode: 0o755 })

  return { root, marker, attempts, solver: createAstapSolver({ executable, catalogPath: root, fieldHeightDegrees: 3, timeoutMs }) }
}

it('sends lossless unsigned-16 FITS, normalizes a solved center and removes per-exposure artifacts', async () => {
  const fixtureData = await fixture(`const image = fs.readFileSync(path)
const header = image.subarray(0,2880).toString()
if (!header.includes('BITPIX  =                   16') || !header.includes('BZERO   =                32768') || !header.includes('BSCALE  =                    1') || image.readInt16BE(2882) + 32768 !== 65535) process.exit(16)
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
  const { solver, marker, attempts } = await fixture('setInterval(() => {}, 1000)')
  const controller = new AbortController()
  const result = solver.solve(frame, hint, controller.signal)
  const rejected = expect(result).rejects.toThrow('operator stopped')
  await vi.waitFor(async () => { expect(await readFile(marker, 'utf8')).toContain('exposure.fits') })
  controller.abort(new Error('operator stopped'))
  await rejected
  expect(await readAttempts(attempts)).toHaveLength(1)
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


it('exports correlated ASTAP diagnostics without merging distinct no-solution causes or retaining unbounded output', async () => {
  const exporter = new InMemorySpanExporter()
  const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] })
  provider.register()

  try {
    for (const [code, outcome] of [[0, 'solved'], [1, 'no-match'], [2, 'insufficient-stars'], [32, 'error']] as const) {
      const { solver } = await fixture(`fs.writeFileSync(1, 'x'.repeat(5000) + 'stdout end')
fs.writeFileSync(2, 'stderr detail')
fs.writeFileSync(path.replace('.fits','.ini'), ${JSON.stringify(ini)})
process.exit(${code})`)

      await trace.getTracer('test').startActiveSpan('alignment.solve', async parent => {
        try {
          const result = solver.solve(frame, hint, new AbortController().signal)

          if (code === 32) await expect(result).rejects.toThrow('exit code 32')
          else await expect(result).resolves.toMatchObject({ status: code === 0 ? 'solved' : 'no-solution' })
        } finally {
          parent.end()
        }
      })
      const spans = exporter.getFinishedSpans()
      const diagnostic = spans.find(span => span.name === 'astap.solve')!
      const parent = spans.find(span => span.name === 'alignment.solve')!
      expect(diagnostic.parentSpanContext?.spanId).toBe(parent.spanContext().spanId)
      const attempts = spans.filter(span => span.name === 'astap.attempt')
      expect(attempts).toHaveLength(code === 1 ? 6 : 1)
      expect(attempts[0]!.parentSpanContext?.spanId).toBe(diagnostic.spanContext().spanId)
      expect(attempts[0]!.attributes).toMatchObject({
        'astap.search_radius_degrees': 10,
        'astap.exit_code': code,
        'astap.outcome': outcome,
        'astap.stdout': 'x'.repeat(4086) + 'stdout end',
        'astap.stdout.truncated': true,
        'astap.stderr': 'stderr detail',
        'astap.stderr.truncated': false,
      })
      expect(diagnostic.attributes).toMatchObject({
        'astap.outcome': outcome,
        'astap.hint.ra_degrees': 30,
        'astap.hint.dec_degrees': 60,
        'astap.field_height_degrees': 3,
        'astap.timeout_ms': 3000,
        'image.width': 2,
        'image.height': 2,
        'image.captured_at': frame.capturedAt,
      })
      exporter.reset()
    }
  } finally {
    await provider.shutdown()
    trace.disable()
    context.disable()
  }
})

async function readAttempts(path: string): Promise<{ path: string, args: string[], hash: string }[]> {
  return (await readFile(path, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
}

it('widens only the radius on the same image and stops at the first solution', async () => {
  const { solver, attempts } = await fixture(`if (process.argv[process.argv.indexOf('-r') + 1] !== '30') process.exit(1)
fs.writeFileSync(path.replace('.fits','.ini'), ${JSON.stringify(ini)})`)

  await expect(solver.solve(frame, hint, new AbortController().signal)).resolves.toMatchObject({ status: 'solved' })
  const calls = await readAttempts(attempts)
  expect(calls.map(call => call.args[call.args.indexOf('-r') + 1])).toEqual(['10', '15', '30'])
  expect(new Set(calls.map(call => call.path)).size).toBe(1)
  expect(new Set(calls.map(call => call.hash)).size).toBe(1)
  expect(new Set(calls.map(call => JSON.stringify(call.args.map((arg, index, args) => args[index - 1] === '-r' ? 'radius' : arg)))).size).toBe(1)
})

it('searches through the full sky for no-match but never retries insufficient stars or process errors', async () => {
  for (const code of [1, 2, 32]) {
    const { solver, attempts } = await fixture(`process.exit(${code})`)
    const result = solver.solve(frame, hint, new AbortController().signal)

    if (code === 32) await expect(result).rejects.toThrow('exit code 32')
    else await expect(result).resolves.toEqual({ status: 'no-solution' })
    const calls = await readAttempts(attempts)
    expect(calls.map(call => call.args[call.args.indexOf('-r') + 1])).toEqual(code === 1 ? ['10', '15', '30', '60', '120', '180'] : ['10'])
  }
})

it('uses the remaining total deadline for later attempts instead of restarting the timeout', async () => {
  const { solver, attempts } = await fixture(`setTimeout(() => process.exit(1), 350)`, 600)
  await expect(solver.solve(frame, hint, new AbortController().signal)).rejects.toThrow('timed out')
  const calls = await readAttempts(attempts)
  expect(calls.map(call => call.args[call.args.indexOf('-r') + 1])).toEqual(['10', '15'])
})
