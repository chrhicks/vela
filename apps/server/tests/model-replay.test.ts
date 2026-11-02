import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect } from '@nats-io/transport-node'
import { jetstream, jetstreamManager } from '@nats-io/jetstream'
import { encodeEvent, subjectOf } from '@vela/rig-events'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { runArchiver } from '../src/run-log/archiver.js'
import { readArchive } from '../src/run-log/archive.js'
import { runShadowModel } from '../src/rig-model/shadow.js'
import { compareModelReplay } from '../src/rig-model/replay.js'
import { checkpointStore } from '../src/rig-model/checkpoint.js'
import { inOrder, s } from '../../../packages/rig-model/test/support.js'
import { modelFixture } from './fixtures/model-stream.js'

it.skipIf(!process.env.TEST_NATS_URL)('broker live assessments equal ordered archive replay after redelivery and service restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'model-replay-'))
  const url = process.env.TEST_NATS_URL!
  const credentialsFile = process.env.TEST_NATS_CREDENTIALS!
  const credentials = z.record(z.string(), z.string()).parse(JSON.parse(await readFile(credentialsFile, 'utf8')))

  const connections = await Promise.all(['provisioner', 'publisher', 'solver'].map(user =>
    connect({ servers: url, user, pass: credentials[user], inboxPrefix: `_INBOX.${user}`, reconnect: false })))

  const [admin, publisher, solver] = connections

  if (!admin || !publisher || !solver) throw new Error('Missing test connection')
  const manager = await jetstreamManager(admin)
  const archiveStop = new AbortController()
  const firstStop = new AbortController()
  const secondStop = new AbortController()

  const archive = runArchiver({ url, credentialsFile, directory: join(directory, 'archive'), signal: archiveStop.signal })
    .catch(error => { if (!archiveStop.signal.aborted) throw error })

  const { baseline, shadow } = modelFixture()
  const events = inOrder(baseline, shadow).filter(event => event.kind !== 'session')
  const options = { url, credentialsFile, directory: join(directory, 'state'), archiveDirectory: join(directory, 'archive') }
  let deliveries = 0
  let restarted: Promise<void> | undefined

  const first = runShadowModel({ ...options, signal: firstStop.signal, onPublished: async () => {
    deliveries++

    if (deliveries !== 35) return
    firstStop.abort()
  } }).catch(error => { if (!firstStop.signal.aborted) throw error })

  try {
    await manager.consumers.update('RIG_FACTS', 'model-v1', { ack_wait: 200_000_000 })

    for (const event of events) {
      const client = jetstream(event.kind === 'solve-result' ? solver : publisher)

      await client.publish(subjectOf(event.rig, event.kind), encodeEvent(event), { msgID: event.id })
    }

    await first
    expect(deliveries).toBe(35)
    const resumeAt = ((await checkpointStore(options.directory).load())?.sequences.get('RIG_FACTS') ?? 0) + 1
    const resumedSequences: number[] = []

    restarted = runShadowModel({ ...options, signal: secondStop.signal, onPublished: async sequence => { resumedSequences.push(sequence) } })
      .catch(error => { if (!secondStop.signal.aborted) throw error })

    await expect.poll(async () => {
      const info = await manager.consumers.info('RIG_FACTS', 'model-v1')

      return info.num_pending + info.num_ack_pending
    }, { timeout: 15000 }).toBe(0)
    const info = await manager.consumers.info('RIG_FACTS', 'model-v1')

    expect(info.delivered.consumer_seq).toBeGreaterThan(events.length)
    expect(resumedSequences[0]).toBe(resumeAt)

    for (const stream of ['RIG_FACTS', 'RIG_ASSESS']) {
      await expect.poll(async () => {
        const state = await manager.consumers.info(stream, 'archiver-v1')

        return state.num_pending + state.num_ack_pending
      }, { timeout: 10000 }).toBe(0)
    }

    secondStop.abort()
    await restarted

    for (const recovery of ['checkpoint', 'archive'] as const) {
      if (recovery === 'archive') await rm(options.directory, { recursive: true })
      const stop = new AbortController()
      let recovered: string | undefined

      await runShadowModel({ ...options,
        archiveDirectory: recovery === 'checkpoint' ? join(directory, 'does-not-exist') : options.archiveDirectory,
        signal: stop.signal,
        onRecovery: path => { recovered = path; stop.abort() },
      }).catch(error => { if (!stop.signal.aborted) throw error })
      expect(recovered).toBe(recovery)
    }

    const range = { from: s(0), to: s(60) }
    const comparison = await compareModelReplay(join(directory, 'archive'), range)
    const records = await Array.fromAsync(readArchive(join(directory, 'archive'), range))

    expect(records.some(event => event.kind === 'pointing-fix' && event.body.outcome === 'fix')).toBe(true)
    expect(comparison.equal).toBe(true)

    const cli = execFileSync(process.execPath, ['--import', createRequire(import.meta.url).resolve('tsx'),
      fileURLToPath(new URL('../src/rig-model/replay-main.ts', import.meta.url)), join(directory, 'archive'), String(range.from), String(range.to)], { encoding: 'utf8' })

    expect(JSON.parse(cli)).toEqual(comparison)
    expect(comparison).toHaveProperty('assessments')
    console.log(JSON.stringify({ comparison, facts: events.length, deliveries: info.delivered.consumer_seq, restart: true, redelivery: true, checkpointWithoutArchive: true, lostCheckpointRebuilt: true }))
    archiveStop.abort()
    await archive
    const day = new Date(shadow.at).toISOString().slice(0, 10)

    await rm(join(directory, 'archive', day, 'pointing-fix'), { recursive: true })
    expect(await compareModelReplay(join(directory, 'archive'), range)).toMatchObject({ equal: false, index: 0 })
  } finally {
    firstStop.abort()
    secondStop.abort()
    archiveStop.abort()
    await Promise.allSettled([first, restarted, archive])
    await Promise.all(connections.map(connection => connection.close()))
    await rm(directory, { recursive: true, force: true })
  }
}, 35000)
