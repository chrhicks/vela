import { fork, execFileSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect } from '@nats-io/transport-node'
import { jetstream, jetstreamManager } from '@nats-io/jetstream'
import { encodeEvent, epochMs, rigId, seal, sourceId, subjectOf } from '@vela/rig-events'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { readArchive } from '../src/run-log/archive.js'

it.skipIf(!process.env.TEST_NATS_URL)('SIGKILL before batch ack and restart replays exactly the published IDs from both streams', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'archiver-kill-'))
  const url = process.env.TEST_NATS_URL!
  const credentialsFile = process.env.TEST_NATS_CREDENTIALS!
  const credentials = z.object({ provisioner: z.string(), publisher: z.string() }).parse(JSON.parse(await readFile(credentialsFile, 'utf8')))
  const admin = await connect({ servers: url, user: 'provisioner', pass: credentials.provisioner, inboxPrefix: '_INBOX.provisioner' })
  const publisher = await connect({ servers: url, user: 'publisher', pass: credentials.publisher, inboxPrefix: '_INBOX.publisher' })
  const js = jetstream(publisher)
  const manager = await jetstreamManager(admin)

  const expected = Array.from({ length: 300 }, (_, n) => {
    const stamp = { rig: rigId('fixture'), source: sourceId('test:archiver'), at: epochMs(1000 + n), seenAt: epochMs(1000 + n) }

    return n % 2 === 0
      ? seal({ ...stamp, kind: 'cria.stream', body: { origin: 'http://fixture.test', event: 'opened', message: null } })
      : seal({ ...stamp, kind: 'aim', body: { goalId: `test-${n}`, target: { raDegrees: 10, decDegrees: 20 }, status: 'refused', reason: 'mount-held', elapsedMs: 0, corrections: 0, residualArcmin: null, toleranceArcmin: 1, maxCorrections: 1, maxElapsedMs: 1000, gotoWarningArcmin: 15, gotoMissArcmin: null, gotoWarning: false, confidence: 'none', pointingBudgetArcmin: null, blindTravelDegrees: null } })
  })

  let child: ChildProcess | undefined
  let output = ''

  function start(pause: boolean) {
    const process = fork(new URL('./fixtures/archiver-child.ts', import.meta.url), [], {
      execArgv: ['--import', createRequire(import.meta.url).resolve('tsx')],
      env: { ...globalThis.process.env, TEST_ARCHIVE_DIR: directory, TEST_PAUSE_BATCH: pause ? '1' : '0' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })

    process.stdout?.on('data', chunk => { output += String(chunk) })
    process.stderr?.on('data', chunk => { output += String(chunk) })

    return process
  }

  async function stop(signal: 'SIGKILL' | 'SIGTERM') {
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    const exited = once(child, 'exit')

    execFileSync('python3', [process.env.TEST_SAFE_KILL!, 'stop', String(child.pid), ...(signal === 'SIGKILL' ? ['--grace', '0.1', '--kill'] : [])])
    await exited
  }

  try {
    for (const stream of ['RIG_FACTS', 'RIG_ASSESS'])
      await manager.consumers.update(stream, 'archiver-v1', { ack_wait: 200_000_000 })

    for (const event of expected) await js.publish(subjectOf(event.rig, event.kind), encodeEvent(event), { msgID: event.id })
    child = start(true)
    const [checkpoint] = await once(child, 'message')

    expect(checkpoint).toBe('durable-before-ack')
    const before = await Array.fromAsync(readArchive(directory, { from: 0, to: 100000 }))

    expect(before.length).toBeGreaterThan(0)
    expect(before.length).toBeLessThan(expected.length)
    await stop('SIGKILL')
    expect(child.signalCode).toBe('SIGKILL')
    child = start(false)
    await expect.poll(async () => (await Array.fromAsync(readArchive(directory, { from: 0, to: 100000 }))).length, { timeout: 15000 }).toBe(expected.length)

    for (const stream of ['RIG_FACTS', 'RIG_ASSESS']) {
      await expect.poll(async () => {
        const info = await manager.consumers.info(stream, 'archiver-v1')

        return info.num_ack_pending + info.num_pending
      }, { timeout: 5000 }).toBe(0)
    }

    await stop('SIGTERM')
    const archived = await Array.fromAsync(readArchive(directory, { from: 0, to: 100000 }))

    expect(archived.map(event => event.id).sort()).toEqual(expected.map(event => event.id).sort())
    expect(output).not.toContain(credentials.provisioner)
    const privateFile = z.record(z.string(), z.string()).parse(JSON.parse(await readFile(credentialsFile, 'utf8')))

    for (const secret of Object.values(privateFile)) expect(output).not.toContain(secret)
    let rawLines = 0

    for (const path of await readdir(directory, { recursive: true })) {
      if (path.endsWith('.jsonl')) rawLines += (await readFile(join(directory, path), 'utf8')).trim().split('\n').length
    }

    expect(rawLines).toBeGreaterThan(expected.length)
    console.log(JSON.stringify({ published: expected.length, beforeKill: before.length, rawLines, uniqueArchived: archived.length, pending: 0, credentialLeaks: 0 }))
  } finally {
    await stop('SIGKILL')
    await publisher.close()
    await admin.close()
    await rm(directory, { recursive: true, force: true })
  }
}, 25000)
