import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { closeSync, constants, openSync } from 'node:fs'
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { FakeCria } from '../../../packages/cria/test/v5/fake-cria.js'

it('exits on SIGTERM within a bound while the Cria journal is a FIFO nobody reads', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vela-server-shutdown-'))
  const fifo = join(directory, 'cria-journal.jsonl')
  const service = new FakeCria()
  const state = await (await service.fetch(`${service.origin}/v2/state`)).json()

  const remote = createServer((request, response) => {
    if (request.url === '/v2/events') {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`)
    } else {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(state))
    }
  })

  remote.listen(0, '127.0.0.1')
  await once(remote, 'listening')
  const { port } = z.object({ port: z.number().int().positive() }).parse(remote.address())

  execFileSync('mkfifo', [fifo])
  const configPath = join(directory, 'cria.json')

  await writeFile(
    configPath,
    JSON.stringify({ rigs: [{ id: 'fixture', name: 'Fixture', url: `http://127.0.0.1:${port}`, devices: [{ id: 'camera', kind: 'camera', expectedName: 'Fake CCD' }] }] }),
  )

  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: join(import.meta.dirname, '..'),
    env: {
      PATH: process.env.PATH,
      HOME: directory,
      PORT: '0',
      HOST: '127.0.0.1',
      VELA_CRIA_CONFIG_PATH: configPath,
      VELA_RIG_CATALOG_PATH: join(directory, 'rigs.json'),
      VELA_SAVED_IMAGES_PATH: join(directory, 'saved'),
      VELA_SURVEY_CACHE_PATH: join(directory, 'survey'),
      VELA_CRIA_JOURNAL_PATH: fifo,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let logs = ''
  child.stdout.on('data', chunk => void (logs += chunk))
  child.stderr.on('data', chunk => void (logs += chunk))

  const exited = new Promise<number | null>(resolve => child.once('exit', code => resolve(code)))

  try {
    for (let step = 0; step < 400 && !/Server listening at/.test(logs); step += 1) {
      await delay(25)

      if (child.exitCode !== null) throw new Error(`server exited early:\n${logs}`)
    }

    expect(logs).toMatch(/Server listening at/)
    await delay(500)

    const stopped = performance.now()
    child.kill('SIGTERM')

    const code = await Promise.race([exited, delay(6_000, 'still running' as const)])

    expect(code, `server still running ${Math.round(performance.now() - stopped)} ms after SIGTERM:\n${logs}`).toBe(0)
    expect(performance.now() - stopped).toBeLessThan(5_000)
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL')
    closeSync(openSync(fifo, constants.O_RDWR | constants.O_NONBLOCK))
    service.close()
    remote.closeAllConnections()
    remote.close()
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
