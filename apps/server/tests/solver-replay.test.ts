import { fork, execFileSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { connect } from '@nats-io/transport-node'
import { jetstream, jetstreamManager } from '@nats-io/jetstream'
import { judgeSolve } from '@vela/rig-astap'
import { decodeLine, encodeEvent, epochMs, rigId, seal, sourceId } from '@vela/rig-events'
import { frameDraft, readFrameRecords, readSavedImages } from '../../../packages/rig-frames/src/index.ts'
import { expect, it } from 'vitest'
import { z } from 'zod'

it.skipIf(!process.env.TEST_NATS_URL)('replays a recorded night through real ASTAP and compares every result with backfill', async () => {
  const data = process.env.TEST_VELA_DATA!
  const privateFile = z.object({ provisioner: z.string(), publisher: z.string() }).parse(JSON.parse(await readFile(process.env.TEST_NATS_CREDENTIALS!, 'utf8')))
  const admin = await connect({ servers: process.env.TEST_NATS_URL!, user: 'provisioner', pass: privateFile.provisioner, inboxPrefix: '_INBOX.provisioner' })
  const publisher = await connect({ servers: process.env.TEST_NATS_URL!, user: 'publisher', pass: privateFile.publisher, inboxPrefix: '_INBOX.publisher' })
  const manager = await jetstreamManager(admin)
  const js = jetstream(publisher)
  const images = await readSavedImages(join(data, 'saved-images'))
  const records = await readFrameRecords([join(data, 'traces/frames.jsonl')])
  const selected = records.records.filter(record => new Date(record.startedAt).toISOString().startsWith(process.env.TEST_NIGHT!))
  const fieldHeightDegrees = Number(process.env.TEST_FIELD_HEIGHT)
  let worker: ChildProcess | undefined
  let output = ''

  function start() {
    const child = fork(new URL('../src/plate-solving/shadow-main.ts', import.meta.url), [], {
      execArgv: ['--import', createRequire(import.meta.url).resolve('tsx')],
      env: { ...process.env, VELA_NATS_URL: process.env.TEST_NATS_URL, VELA_NATS_CREDENTIALS_FILE: process.env.TEST_NATS_CREDENTIALS,
        VELA_SAVED_IMAGES_PATH: join(data, 'saved-images'), VELA_ASTAP: join(data, 'astap/astap_cli'),
        VELA_STAR_CATALOG: join(data, 'astap/catalog/opt/astap'), VELA_SOLVER_FIELD_HEIGHT_DEGREES: String(fieldHeightDegrees) },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })

    child.stdout?.on('data', chunk => { output += String(chunk) })
    child.stderr?.on('data', chunk => { output += String(chunk) })

    return child
  }

  async function stop() {
    if (!worker || worker.exitCode !== null || worker.signalCode !== null) return
    const exited = once(worker, 'exit')

    execFileSync('python3', [process.env.TEST_SAFE_KILL!, 'stop', String(worker.pid)])
    await exited
  }

  try {
    expect(records.problems).toHaveLength(0)
    expect(selected.length).toBeGreaterThan(0)
    const events = selected.map(record => seal(frameDraft(record, images.images.find(image => image.id === record.image?.id), rigId('replay'), sourceId('replay:recorded'))))
    const light = events.filter(event => event.body.frameType === 'light' && event.body.outcome === 'saved')

    expect(light.length).toBeGreaterThan(0)
    expect(light.every(event => event.body.image?.ref)).toBe(true)

    for (const event of events) await js.publish('rig.v1.replay.fact.frame', encodeEvent(event))
    const first = light[0]!
    const calibration = seal({ ...first, at: epochMs(first.at + 1), body: { ...first.body, frameType: 'dark', image: null } })

    await js.publish('rig.v1.replay.fact.frame', encodeEvent(calibration))
    worker = start()
    await expect.poll(async () => {
      if (worker?.exitCode !== null) throw new Error('Shadow worker failed')
      const info = await manager.consumers.info('RIG_FACTS', 'solver-v1')

      return info.num_pending + info.num_ack_pending
    }, { timeout: 600_000, interval: 1000 }).toBe(0)
    const info = await manager.streams.info('RIG_FACTS')
    const results = []

    for (let seq = info.state.first_seq; seq <= info.state.last_seq; seq++) {
      const message = await manager.streams.getMessage('RIG_FACTS', { seq })
      const decoded = decodeLine(message.string())

      if (decoded.ok && decoded.event.kind === 'solve-result') results.push(decoded.event)
    }

    expect(results).toHaveLength(light.length)
    expect(new Set(results.map(event => event.body.frameEventId))).toEqual(new Set(light.map(event => event.id)))
    let maxScaleDifference = 0

    for (const event of light) {
      const result = results.find(result => result.body.frameEventId === event.id)!.body
      const image = images.images.find(image => image.id === event.body.image?.id)!
      const digest = createHash('sha256').update(await readFile(image.fitsPath)).digest('hex')
      const cached = JSON.parse(await readFile(join(process.env.TEST_BACKFILL_CACHE!, `${digest}.json`), 'utf8'))
      const raw = cached.body

      expect(result.solve.solverVersion).toBe(cached.solverVersion)
      expect(fieldHeightDegrees).toBe(cached.fieldHeightDegrees)
      expect(result.solve.status).toBe(raw.status)
      const expected = judgeSolve({ solution: raw, stars: null, claimed: null }, { arcsecPerPixel: fieldHeightDegrees * 3600 / image.height, parity: 1 }, 'framing')

      expect(result.verdict.status).toBe(expected.status)

      if (raw.status === 'solved' && result.verdict.measured) {
        const [a, b, c, d] = raw.wcs.cd
        const scale = Math.sqrt(Math.abs(a * d - b * c)) * 3600
        const difference = Math.abs(result.verdict.measured.arcsecPerPixel / scale - 1)

        maxScaleDifference = Math.max(maxScaleDifference, difference)
        expect(difference).toBeLessThanOrEqual(0.001)
      }
    }

    await stop()
    const original = await manager.streams.info('RIG_FACTS')

    await manager.streams.update('RIG_FACTS', { subjects: original.config.subjects.filter(subject => !subject.endsWith('.solve-result')) })
    await js.publish('rig.v1.replay.fact.frame', encodeEvent(first))
    worker = start()
    const [exitCode] = await once(worker, 'exit')
    const unacked = await manager.consumers.info('RIG_FACTS', 'solver-v1')

    expect(exitCode).toBe(1)
    expect(unacked.num_ack_pending).toBe(1)
    expect(unacked.num_pending).toBe(0)
    expect(output).toContain('Shadow solver stopped;')
    const secrets = z.record(z.string(), z.string()).parse(JSON.parse(await readFile(process.env.TEST_NATS_CREDENTIALS!, 'utf8')))

    for (const secret of Object.values(secrets)) expect(output.includes(secret)).toBe(false)
    console.log(JSON.stringify({ recordedFrames: events.length, savedLights: light.length, results: results.length, calibrationSkipped: 1,
      pendingAfterReplay: 0, passFailMatches: light.length, maxScaleDifference, publishFailureUnacked: 1, credentialLeaks: 0 }))
  } finally {
    await stop()
    await publisher.close()
    await admin.close()
  }
}, 650_000)
