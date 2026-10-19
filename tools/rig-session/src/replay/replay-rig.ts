import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { criaProgram, type CriaCheckout } from './cria-checkout.ts'
import { criaConfigFor, replayRigId, velaCriaConfigFor } from './rig-config.ts'
import { freePort, startService, type Service } from './services.ts'
import type { ReplayFault } from './faults.ts'
import type { Json } from './views.ts'

const velaRoot = fileURLToPath(new URL('../../../../', import.meta.url))

const manifestSchema = z.object({
  devices: z.array(z.object({ id: z.string(), kind: z.string(), indiDevice: z.string() })),
})

export interface ReplayRigOptions {
  /** A Cria recording folder, from errai or from `indi-replay synthesize`. */
  recording: string
  cria: CriaCheckout
  /** Names the rig `replay: <name>`. Default: the recording's folder name. */
  name?: string | undefined
  /** The first source frame to serve. */
  fromFrame?: number | undefined
  faults?: ReadonlyArray<ReplayFault> | undefined
  /** How long Cria waits after an exposure for its frame; shorten it for a scenario that makes a frame never come. */
  readoutAllowanceMs?: number | undefined
  /** Keep the temporary folder when the rig stops. */
  keep?: boolean | undefined
}

export interface ReplayRig {
  /** Everything the rig writes is under this folder, and it is removed when the rig stops (unless `keep`). */
  readonly folder: string
  readonly rigId: string
  readonly rigName: string
  readonly urls: { readonly vela: string; readonly cria: string; readonly indiReplay: string }
  readonly paths: {
    readonly frameRecords: string
    readonly savedImages: string
    readonly traces: string
    readonly journal: string
    readonly logs: string
  }
  /** Resolves with the name of the first service to end, which is a failure while the rig is running. */
  readonly died: Promise<string>
  /** A request to Vela's HTTP API. The reply is read with `schema` when it is a 200 and returned as text otherwise. */
  api<T>(method: 'GET' | 'POST', path: string, schema: z.ZodType<T>, body?: Json): Promise<{ ok: true; body: T } | { ok: false; status: number; body: string }>
  stop(): Promise<void>
}

/**
 * Starts indi-replay, the pinned Cria and the Vela server. Every path they write and `HOME` are
 * inside one temporary folder, and they inherit nothing else of this process's environment.
 */
export async function startReplayRig(options: ReplayRigOptions): Promise<ReplayRig> {
  const recording = resolve(options.recording)
  const name = options.name ?? basename(recording)
  const rigId = replayRigId(name)
  const server = join(velaRoot, 'apps', 'server', 'dist', 'server.js')

  try {
    await access(server)
  } catch {
    throw new Error(`${server} is not built. Run: pnpm --filter '@vela/server...' build`)
  }

  const manifest = await readFile(join(recording, 'manifest.json'), 'utf8').catch(() => {
    throw new Error(`${recording} is not a Cria recording: it has no manifest.json.`)
  })

  const { devices } = manifestSchema.parse(JSON.parse(manifest))
  const folder = await mkdtemp(join(tmpdir(), 'vela-replay-'))
  const started: Service[] = []

  const paths = {
    frameRecords: join(folder, 'vela', 'frame-records.jsonl'),
    savedImages: join(folder, 'vela', 'saved-images'),
    traces: join(folder, 'vela', 'traces.jsonl'),
    journal: join(folder, 'vela', 'cria-journal.jsonl'),
    logs: join(folder, 'logs'),
  }

  const environment = {
    PATH: process.env.PATH ?? '',
    HOME: join(folder, 'home'),
    TMPDIR: join(folder, 'tmp'),
    XDG_CACHE_HOME: join(folder, 'home', '.cache'),
    XDG_CONFIG_HOME: join(folder, 'home', '.config'),
    XDG_DATA_HOME: join(folder, 'home', '.local', 'share'),
    XDG_STATE_HOME: join(folder, 'home', '.local', 'state'),
  }

  async function stop() {
    for (const service of started.reverse()) await service.stop()

    if (!options.keep) await rm(folder, { recursive: true, force: true })
  }

  try {
    await Promise.all([
      mkdir(paths.logs, { recursive: true }),
      mkdir(environment.TMPDIR, { recursive: true }),
      mkdir(environment.XDG_CACHE_HOME, { recursive: true }),
      mkdir(join(folder, 'cria', 'images'), { recursive: true }),
      mkdir(join(folder, 'vela'), { recursive: true }),
    ])

    const replayProgram = criaProgram(options.cria, 'indi-replay')
    const faultsFile = join(folder, 'faults.json')
    const faultArguments: string[] = []
    const fromArguments: string[] = []

    if (options.faults?.length) {
      await writeFile(faultsFile, JSON.stringify(options.faults))
      faultArguments.push('--faults', faultsFile)
    }

    if (options.fromFrame !== undefined) fromArguments.push('--from', String(options.fromFrame))

    const replay = await startService({
      name: 'indi-replay',
      command: replayProgram.command,
      args: [
        ...replayProgram.args,
        'serve',
        recording,
        ...fromArguments,
        ...faultArguments,
      ],
      env: environment,
      cwd: folder,
      logFile: join(paths.logs, 'indi-replay.log'),
      ready: /listening on 127\.0\.0\.1:(\d+)/,
    })

    started.push(replay.service)

    const indiPort = Number(replay.match)
    const imagingIndiDevice = /serving \d+ frames of (.+) from /.exec(replay.service.output())?.[1]

    if (!imagingIndiDevice) throw new Error(`indi-replay did not say which camera it serves:\n${replay.service.output()}`)

    const criaConfig = join(folder, 'cria', 'cria.json')

    const criaSettings = { indiPort, imageDirectory: join(folder, 'cria', 'images'), readoutAllowanceMs: options.readoutAllowanceMs }

    await writeFile(criaConfig, JSON.stringify(criaConfigFor(devices, criaSettings)))

    const criaProgramLine = criaProgram(options.cria, 'cria')

    const cria = await startService({
      name: 'cria',
      command: criaProgramLine.command,
      args: [...criaProgramLine.args, criaConfig],
      env: environment,
      cwd: folder,
      logFile: join(paths.logs, 'cria.log'),
      ready: /listening on (\d+)/,
    })

    started.push(cria.service)

    const criaUrl = `http://127.0.0.1:${cria.match}`
    const velaPort = await freePort()
    const velaCriaConfig = join(folder, 'vela', 'cria.json')

    await writeFile(velaCriaConfig, JSON.stringify(velaCriaConfigFor(name, devices, { criaUrl, imagingIndiDevice })))

    const vela = await startService({
      name: 'vela',
      command: process.execPath,
      args: [server],
      env: {
        ...environment,
        HOST: '127.0.0.1',
        PORT: String(velaPort),
        VELA_RIG_CATALOG_PATH: join(folder, 'vela', 'rigs.yaml'),
        VELA_CRIA_CONFIG_PATH: velaCriaConfig,
        VELA_SAVED_IMAGES_PATH: paths.savedImages,
        VELA_SURVEY_CACHE_PATH: join(folder, 'vela', 'survey-cache'),
        VELA_TRACE_PATH: paths.traces,
        VELA_FRAME_RECORDS_PATH: paths.frameRecords,
        VELA_CRIA_JOURNAL_PATH: paths.journal,
        VELA_ALERTS_CONFIG_PATH: join(folder, 'vela', 'alerts.json'),
      },
      cwd: folder,
      logFile: join(paths.logs, 'vela.log'),
      ready: /Server listening at http:\/\/127\.0\.0\.1:(\d+)/,
    })

    started.push(vela.service)

    const velaUrl = `http://127.0.0.1:${vela.match}`

    return {
      folder,
      died: Promise.race(started.map(service => service.exited.then(() => service.name))),
      rigId,
      rigName: `replay: ${name}`,
      urls: { vela: velaUrl, cria: criaUrl, indiReplay: `127.0.0.1:${indiPort}` },
      paths,
      async api(method, path, schema, body) {
        const init: RequestInit = { method }

        if (body !== undefined) {
          init.headers = { 'content-type': 'application/json' }
          init.body = JSON.stringify(body)
        }

        const response = await fetch(`${velaUrl}${path}`, init)

        if (response.status !== 200) return { ok: false, status: response.status, body: await response.text() }

        return { ok: true, body: schema.parse(await response.json()) }
      },
      stop,
    }
  } catch (error) {
    await stop()
    throw error
  }
}
