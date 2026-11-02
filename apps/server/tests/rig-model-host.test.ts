import { fork } from 'node:child_process'
import { once } from 'node:events'
import { appendFile, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { encodeEvent } from '@vela/rig-events'
import { frame, imageIdOf, session, snapshot, solved, steady, testRig } from '@vela/rig-testing'
import { createModelHost, modelRunLog } from '../src/rig-model/host.js'
import { openRunLog } from '../src/run-log/run-log.js'
import { buildApp } from '../src/app.js'
import { createMemoryRigCatalog } from '../src/rig/catalog.js'

const start = Date.UTC(2026, 10, 1)

it('restores after SIGKILL mid-sweep with its last fix and budget, ignoring a torn last line', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vela-model-crash-'))
  const child = fork(join(import.meta.dirname, 'fixtures/model-sweep.ts'), [directory], { cwd: join(import.meta.dirname, '..'), execArgv: ['--import', 'tsx'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  let restored: ReturnType<typeof createModelHost> | undefined
  let restartedApp: ReturnType<typeof buildApp> | undefined
  let nextLog: ReturnType<typeof openRunLog> | undefined
  const exited = once(child, 'exit')

  try {
    const [message] = await Promise.race([once(child, 'message'), exited.then(() => { throw new Error('sweep child exited before reporting') })])
    const before = message.assessment

    expect(before.position.state).toBe('moving')
    expect(before.lastFix).not.toBeNull()
    expect(before.blindTravelDegrees).toBeCloseTo(15)
    child.kill('SIGKILL')
    await exited
    const files = (await readdir(directory)).sort()
    expect(files.length).toBeGreaterThan(1)
    await appendFile(join(directory, files.at(-1)!), encodeEvent(session(start + 14_000)))
    restored = createModelHost(directory, () => start + 20_000)
    await restored.ready

    expect(restored.get(testRig)).toMatchObject({
      position: { state: 'uncertain', reason: 'vela-restarted' },
      lastFix: before.lastFix,
      budgetArcmin: before.budgetArcmin,
      blindTravelDegrees: before.blindTravelDegrees,
    })
    const catalog = createMemoryRigCatalog([{ id: testRig, name: 'Synthetic', endpoint: { host: 'localhost', port: 1 }, addedAt: new Date(start).toISOString(), lastObservedInventory: { observedAt: new Date(start).toISOString(), devices: [] } }])
    restartedApp = buildApp({ rigCatalog: catalog, models: restored })
    const response = await restartedApp.inject(`/api/rigs/${testRig}/model`)

    expect(response.statusCode).toBe(200)
    expect(response.json().position).toMatchObject({ state: 'uncertain', reason: 'vela-restarted' })
    nextLog = modelRunLog(openRunLog({ directory }), restored)
    nextLog.append(snapshot({ at: start + 21_000, instanceId: message.instanceId, bindingId: message.bindingId, mount: { at: start + 21_000, raHours: 4, decDegrees: 0, frame: 'j2000' } }))
    expect(restored.get(testRig)?.position.state).toBe('uncertain')
    expect(restored.get(testRig)?.blindTravelDegrees).toBe(before.blindTravelDegrees)
  } finally {
    await restartedApp?.close()
    await nextLog?.close()
    restored?.close()

    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exited }

    await rm(directory, { recursive: true, force: true })
  }
}, 20_000)

it('taps append, isolates rigs, advances time without reads, and exposes a detached assessment by GET', async () => {
  vi.useFakeTimers({ now: start })
  const host = createModelHost()
  const directory = await mkdtemp(join(tmpdir(), 'vela-model-live-'))
  const log = modelRunLog(openRunLog({ directory }), host)
  const catalog = createMemoryRigCatalog()
  await catalog.add({ id: testRig, name: 'Synthetic', endpoint: { host: 'localhost', port: 1 }, inventory: { observedAt: new Date(start).toISOString(), devices: [] } })
  const app = buildApp({ rigCatalog: catalog, models: host })

  try {
    await host.ready

    for (const event of steady({ from: start, to: start + 5000, mount: { at: start, raHours: 2, decDegrees: 0, frame: 'j2000' } })) log.append(event)
    const image = imageIdOf(2)
    log.append(frame({ image, capturedAt: start + 1000, exposureSeconds: 2, seenAt: start + 3000 }))
    log.append(solved(image, { raDegrees: 30.001, decDegrees: 0 }, start + 6000))
    expect(host.get(testRig)?.position.state).toBe('known')
    expect(host.get('another-rig')).toBeNull()
    const response = await app.inject(`/api/rigs/${testRig}/model`)
    expect(response.statusCode).toBe(200)
    expect(response.json().position.state).toBe('known')
    const copy = host.get(testRig)!
    Object.assign(copy.lastFix!, { errorArcmin: { total: 1000 } })
    expect(host.get(testRig)?.lastFix?.errorArcmin.total).toBeLessThan(1)
    await vi.advanceTimersByTimeAsync(16_000)
    expect(host.get(testRig)?.position).toMatchObject({ state: 'uncertain', reason: 'stream-gap' })
    expect((await app.inject('/api/rigs/missing/model')).statusCode).toBe(404)
  } finally {
    await app.close()
    host.close()
    await log.close()
    vi.useRealTimers()
    await rm(directory, { recursive: true, force: true })
  }
})

it('queues live inputs behind replay and refuses corrupt whole lines', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vela-model-restore-'))
  const event = snapshot({ at: start, mount: { at: start, raHours: 2, decDegrees: 0 } })
  const host = createModelHost(directory, () => start)

  try {
    host.onAppend(event)
    expect(host.get(testRig)).toBeNull()
    await host.ready
    expect(host.get(testRig)).not.toBeNull()
    await writeFile(join(directory, 'bad.jsonl'), '{broken}\n')
    const broken = createModelHost(directory)

    try {
      await expect(broken.ready).rejects.toThrow('invalid log line')
      expect(broken.get(testRig)).toBeNull()
    } finally { broken.close() }
  } finally {
    host.close()
    await rm(directory, { recursive: true, force: true })
  }
})
