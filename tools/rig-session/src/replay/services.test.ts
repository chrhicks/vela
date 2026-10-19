import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { freePort, startService } from './services.ts'

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'services-'))
})

afterEach(() => rm(directory, { recursive: true, force: true }))

const node = (script: string, ready: RegExp, timeoutMs = 5000) => ({
  name: 'probe',
  command: process.execPath,
  args: ['-e', script],
  env: { PATH: process.env.PATH ?? '' },
  cwd: directory,
  logFile: join(directory, 'probe.log'),
  ready,
  timeoutMs,
})

test('a service is up when its output matches, and the match is its address; stop ends it and its log keeps what it printed', async () => {
  const { service, match } = await startService(node("console.log('listening on 4242'); setInterval(() => {}, 1000)", /listening on (\d+)/))

  expect(match).toBe('4242')
  await service.stop()
  await service.exited
  expect(await readFile(join(directory, 'probe.log'), 'utf8')).toBe('listening on 4242\n')
})

test('a service that exits before it is ready fails with its output', async () => {
  await expect(startService(node("console.error('no config'); process.exit(3)", /ready (\d+)/))).rejects.toThrow('exited with 3 before it was ready. Its output:\nno config')
})

test('a service that is never ready is stopped when the wait runs out', async () => {
  await expect(startService(node('setInterval(() => {}, 1000)', /ready (\d+)/, 300))).rejects.toThrow('did not become ready in 300 ms')
})

test('a service that ignores SIGTERM is killed after the grace period', async () => {
  const { service } = await startService(node("process.on('SIGTERM', () => {}); console.log('up 1'); setInterval(() => {}, 1000)", /up (\d+)/))

  await service.stop(200)
  await service.exited
})

test('a free port can be listened on', async () => {
  expect(await freePort()).toBeGreaterThan(1023)
})
