import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { startReplayRig, type ReplayRig, type ReplayRigOptions } from './replay-rig.ts'
import { alertsView, attempt, captureView, savedImagesView, type Attempt, type SavedFrame } from './views.ts'

export interface ScenarioOptions extends Omit<ReplayRigOptions, 'recording'> {
  exposureSeconds: number
  /**
   * The run is stopped once this many exposure attempts have settled, or sooner if it ends by itself.
   * The next exposure has usually started by then, so it settles as `stopped` after these.
   */
  attempts: number
  /** Default 120 s. */
  timeoutMs?: number
}

export interface ScenarioResult {
  /** The saved frames in the order they were taken, as `GET /api/web/rigs/:id/saved-images` reports them. */
  frames: SavedFrame[]
  /** One per settled attempt, successful or not, from Vela's frame record file. */
  attempts: Attempt[]
  /** Each alert Vela raised, with how many attempts had settled the first time the alerts view showed it. */
  alertsRaised: Array<{ id: string; level: 'warn' | 'critical'; message: string; afterAttempts: number }>
  /** How the run ended, as the capture view reports it. */
  finalPhase: string
  finalError: string | null
  /** The bytes of each saved frame's FITS file, in the same order as `frames`. */
  fits: Buffer[]
}

const pollMs = 250

async function readAttempts(path: string): Promise<Attempt[]> {
  try {
    return (await readFile(path, 'utf8')).split('\n').filter(Boolean).map(line => attempt.parse(JSON.parse(line)))
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
    throw error
  }
}

/**
 * Runs a capture against a recording and returns what Vela reported. The whole rig is started,
 * run and torn down inside this call; nothing it writes outlives it.
 */
export async function runScenario(recording: string, options: ScenarioOptions): Promise<ScenarioResult> {
  const { exposureSeconds, attempts, timeoutMs = 120_000, ...rigOptions } = options
  const rig = await startReplayRig({ recording, ...rigOptions })

  try {
    return await capture(rig, exposureSeconds, attempts, timeoutMs)
  } finally {
    await rig.stop()
  }
}

async function get<T>(rig: ReplayRig, path: string, schema: z.ZodType<T>): Promise<T> {
  const reply = await rig.api('GET', path, schema)

  if (!reply.ok) throw new Error(`GET ${path} answered ${reply.status}: ${reply.body}`)

  return reply.body
}

async function capture(rig: ReplayRig, exposureSeconds: number, wanted: number, timeoutMs: number): Promise<ScenarioResult> {
  const base = `/api/rigs/${rig.rigId}`
  const view = `/api/web/rigs/${rig.rigId}`
  const alertsRaised: ScenarioResult['alertsRaised'] = []
  const deadline = Date.now() + timeoutMs
  const start = await rig.api('POST', `${base}/capture/start`, captureView, { exposureSeconds, repeat: true, saveFrames: true })

  if (!start.ok) throw new Error(`Vela refused to start the capture (${start.status}): ${start.body}`)

  const wait = (ms: number) => new Promise<'waited'>(resolve => setTimeout(() => resolve('waited'), ms))

  const pause = async () => {
    const died = await Promise.race([wait(pollMs), rig.died])

    if (died !== 'waited') throw new Error(`${died} stopped while the scenario ran. See ${rig.paths.logs}.`)
  }

  let attempts = await readAttempts(rig.paths.frameRecords)
  let current = await get(rig, `${view}/capture`, captureView)

  while (current.active && attempts.length < wanted) {
    if (Date.now() > deadline) throw new Error(`The scenario did not finish in ${timeoutMs} ms; ${attempts.length} of ${wanted} attempts had settled.`)
    await pause()

    attempts = await readAttempts(rig.paths.frameRecords)
    current = await get(rig, `${view}/capture`, captureView)

    for (const alert of (await get(rig, `${view}/alerts`, alertsView)).alerts) {
      if (!alertsRaised.some(seen => seen.id === alert.id))
        alertsRaised.push({ id: alert.id, level: alert.level, message: alert.message, afterAttempts: attempts.length })
    }
  }

  if (current.active) await rig.api('POST', `${base}/capture/stop`, captureView, {})

  while (current.active && Date.now() <= deadline) {
    await pause()
    current = await get(rig, `${view}/capture`, captureView)
  }

  const saved = (await get(rig, `${view}/saved-images`, savedImagesView)).images
  const frames = [...saved].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))

  const fits = await Promise.all(
    frames.map(async frame => Buffer.from(await (await fetch(`${rig.urls.vela}${frame.fitsUrl}`)).arrayBuffer())),
  )

  return { frames, attempts: await readAttempts(rig.paths.frameRecords), alertsRaised, finalPhase: current.phase, finalError: current.error, fits }
}
