import { basename } from 'node:path'
import type { Sender } from '../commands/sender.ts'
import { announcesFrame } from '../frames/announce.ts'
import type { Picture } from '../rig/picture.ts'
import { readWireBody, type Entry } from '../stream/entry.ts'
import { makeChanges } from './changes.ts'
import type { RunEvent } from './events.ts'
import { stepsFor, wantedOf, type Step, type Wanted } from './plan.ts'
import { parseRequest, type CaptureRequest } from './request.ts'
import type { RunFile } from './runfile.ts'

export type EndReason = 'done' | 'stopped' | 'failures' | 'interrupted' | 'refused' | 'unknown'

export interface Ending {
  readonly run: string
  readonly reason: EndReason
  readonly detail: string
  readonly counted: number
  readonly failed: number
  readonly at: number
}

export interface CaptureSettings {
  readonly device: string
  readonly spoolDir: string
  readonly settleMs: number
  readonly exposureSilenceMs: number
  readonly failuresInRow: number
  readonly silenceMs: number
  readonly telescope: string | undefined
}

export interface CaptureOptions {
  readonly picture: Pick<Picture, 'property' | 'rig' | 'indi' | 'heardAt'>
  readonly sender: Pick<Sender, 'send'>
  readonly settings: CaptureSettings
  readonly runFile: RunFile
  readonly nextName: (sequence: string) => Promise<string>
  readonly now: () => number
  readonly newRunId: () => string
  readonly emit: (event: RunEvent) => void
  readonly onChange: () => void
}

export interface FrameLabel {
  readonly run: string
  readonly sequence: string
  readonly frame: number
}

export interface CaptureView {
  readonly at: number
  readonly run:
    | {
        readonly id: string
        readonly object: string
        readonly frameType: string
        readonly exposureSeconds: number
        readonly count: number | undefined
        readonly counted: number
        readonly failed: number
        readonly frame: number
        readonly phase: 'preparing' | 'exposing' | 'ending'
        readonly secondsLeft: number | undefined
      }
    | undefined
  readonly last: Ending | undefined
}

export type Between = (frame: number, signal: AbortSignal) => Promise<string | undefined>

export type StartResult = { readonly ok: true; readonly run: string; readonly done: Promise<void> } | { readonly ok: false; readonly reason: string }

interface Active {
  readonly id: string
  readonly request: CaptureRequest
  readonly sequence: string
  wanted: Wanted
  named: boolean
  readonly abort: AbortController
  readonly between: Between | undefined
  readonly startedAt: number
  counted: number
  failed: number
  inARow: number
  phase: 'preparing' | 'exposing' | 'ending'
  exposureEndsAt: number | undefined
  stopping: Promise<string> | undefined
  watch: { alerted: boolean; file: string | undefined; previous: string | undefined; exposureHeardAt: number } | undefined
}

type Stop = { readonly reason: EndReason; readonly detail: string }

const abortCommand = (device: string) => ({ device, property: 'CCD_ABORT_EXPOSURE', values: { ABORT: true } })

export function makeCapture({ picture, sender, settings, runFile, nextName, now, newRunId, emit, onChange }: CaptureOptions) {
  const changes = makeChanges()
  const labels = new Map<string, FrameLabel>()
  let active: Active | undefined
  let last: Ending | undefined

  const read = (property: string) => picture.property(settings.device, property)

  function refusalToStart(request: CaptureRequest, wanted: Wanted): string | undefined {
    if (active !== undefined) return 'a capture is already running'
    if (picture.rig() === undefined) return 'the stream shows no rig connection'
    if (picture.indi() !== 'connected') return 'indiserver is not connected'

    const heard = picture.heardAt()

    if (heard === undefined || now() - heard > settings.silenceMs) return `the rig program has been silent for more than ${settings.silenceMs / 1000} s`
    if (read('CCD_EXPOSURE') === undefined) return `${settings.device} has no CCD_EXPOSURE on the stream`
    if (read('CCD_EXPOSURE')?.state === 'Busy') return 'the camera is already exposing'

    const upload = read('UPLOAD_MODE')

    if (upload === undefined || (upload.values['UPLOAD_LOCAL'] !== true && upload.values['UPLOAD_BOTH'] !== true)) return 'the camera is not saving frames on the rig computer (UPLOAD_MODE is not local)'
    if (read('CCD_FILE_PATH') === undefined) return 'the camera does not name its saved files (no CCD_FILE_PATH on the stream)'

    const plan = stepsFor(read, wanted, true)

    return 'missing' in plan ? `the camera has no ${plan.missing} on the stream` : undefined
  }

  function finish(run: Active, stop: Stop): Ending {
    const ending: Ending = { run: run.id, reason: stop.reason, detail: stop.detail, counted: run.counted, failed: run.failed, at: now() }

    runFile.clear()
    active = undefined
    last = ending
    emit({ kind: 'ended', run: run.id, body: { reason: ending.reason, detail: ending.detail, counted: ending.counted, failed: ending.failed } })
    onChange()

    return ending
  }

  function stoppedOr(run: Active, stop: Stop): Stop {
    return run.abort.signal.aborted ? { reason: 'stopped', detail: 'Stop pressed' } : stop
  }

  async function apply(run: Active, step: Step): Promise<Stop | undefined> {
    const outcome = await sender.send({ device: settings.device, property: step.property, values: step.values })

    if (outcome.result !== 'written') return { reason: outcome.result, detail: `${step.property}: ${outcome.reason}` }

    if (step.shows !== undefined) {
      const shows = step.shows
      const seen = await changes.until(() => shows(read), settings.settleMs, run.abort.signal)

      if (!seen) return stoppedOr(run, { reason: 'unknown', detail: `${step.property} was written but the stream does not show it within ${settings.settleMs / 1000} s` })
    }

    return run.abort.signal.aborted ? { reason: 'stopped', detail: 'Stop pressed' } : undefined
  }

  async function prepare(run: Active, first: boolean): Promise<Stop | undefined> {
    run.phase = 'preparing'
    onChange()

    const idle = await changes.until(() => read('CCD_EXPOSURE')?.state !== 'Busy', settings.settleMs, run.abort.signal)

    if (!idle) return stoppedOr(run, { reason: 'unknown', detail: `the camera is still exposing ${settings.settleMs / 1000} s after the last frame ended` })

    if (!run.named) run.wanted = { ...run.wanted, uploadPrefix: await nextName(run.sequence) }

    run.named = true

    const plan = stepsFor(read, run.wanted, first)

    if ('missing' in plan) return { reason: 'refused', detail: `the camera has no ${plan.missing} on the stream` }

    for (const step of plan.steps) {
      const stop = await apply(run, step)

      if (stop !== undefined) return stop
    }

    return undefined
  }

  type Frame = { readonly frame: 'file'; readonly path: string } | { readonly frame: 'failed'; readonly why: 'alert' | 'silent' } | { readonly frame: 'stop'; readonly stop: Stop }

  async function expose(run: Active): Promise<Frame> {
    const watch = { alerted: false, file: undefined as string | undefined, previous: read('CCD_FILE_PATH')?.values['FILE_PATH'] as string | undefined, exposureHeardAt: now() }
    const exposureMs = run.request.exposureSeconds * 1000

    run.watch = watch
    run.phase = 'exposing'

    const outcome = await sender.send({ device: settings.device, property: 'CCD_EXPOSURE', values: { CCD_EXPOSURE_VALUE: run.request.exposureSeconds } })

    if (outcome.result !== 'written') {
      run.watch = undefined

      if (outcome.result === 'unknown') await sender.send(abortCommand(settings.device))

      return { frame: 'stop', stop: stoppedOr(run, { reason: outcome.result, detail: `CCD_EXPOSURE: ${outcome.reason}` }) }
    }

    run.exposureEndsAt = now() + exposureMs
    onChange()

    const finished = () => watch.file !== undefined || watch.alerted

    while (!finished() && !run.abort.signal.aborted) {
      const remainingMs = watch.exposureHeardAt + settings.exposureSilenceMs - now()

      if (remainingMs <= 0) break

      await changes.until(finished, remainingMs, run.abort.signal)
    }

    run.watch = undefined
    run.exposureEndsAt = undefined

    if (watch.file !== undefined) return { frame: 'file', path: watch.file }
    await sender.send(abortCommand(settings.device))

    if (run.abort.signal.aborted) return { frame: 'stop', stop: { reason: 'stopped', detail: 'Stop pressed' } }

    return { frame: 'failed', why: watch.alerted ? 'alert' : 'silent' }
  }

  async function execute(run: Active) {
    try {
      await runFrames(run)
    } catch (error) {
      await finishWith(run, { reason: 'unknown', detail: `Vela failed: ${error instanceof Error ? error.message : String(error)}` })
    }
  }

  async function runFrames(run: Active) {
    let first = true

    while (run.request.count === undefined || run.counted < run.request.count) {
      const stop = await prepare(run, first)

      if (stop !== undefined) return finishWith(run, stop)

      first = false

      const refused = await run.between?.(run.counted, run.abort.signal)

      if (run.abort.signal.aborted) return finishWith(run, { reason: 'stopped', detail: 'Stop pressed' })
      if (refused !== undefined) return finishWith(run, { reason: 'refused', detail: refused })

      const result = await expose(run)

      if (result.frame === 'stop') return finishWith(run, result.stop)

      if (result.frame === 'file') {
        run.named = false
        run.counted += 1
        run.inARow = 0
        emit({ kind: 'exposed', run: run.id, body: { frame: run.counted, sequence: run.sequence, file: basename(result.path) } })
        runFile.write({ run: run.id, startedAt: run.startedAt, object: run.request.object, frameType: run.request.frameType, count: run.request.count, counted: run.counted })
      } else {
        run.failed += 1
        run.inARow += 1
        emit({ kind: 'failed', run: run.id, body: { attempt: run.counted + run.failed, why: result.why } })

        if (run.inARow >= settings.failuresInRow) return finishWith(run, { reason: 'failures', detail: `${run.inARow} exposures in a row failed` })
      }

      onChange()
      if (run.abort.signal.aborted) return finishWith(run, { reason: 'stopped', detail: 'Stop pressed' })
    }

    await finishWith(run, { reason: 'done', detail: `${run.counted} frames` })
  }

  async function finishWith(run: Active, stop: Stop) {
    run.phase = 'ending'
    onChange()

    const stopped = run.stopping === undefined ? undefined : await run.stopping

    finish(run, stopped === undefined || stop.reason !== 'stopped' ? stop : { reason: 'stopped', detail: stopped })
  }

  return {
    start(json: unknown, between?: Between): StartResult {
      const parsed = parseRequest(json)

      if (!parsed.ok) return parsed

      const wanted = wantedOf(parsed.request, parsed.sequence, settings.spoolDir, settings.telescope)
      const refusal = refusalToStart(parsed.request, wanted)

      if (refusal !== undefined) return { ok: false, reason: refusal }

      const run: Active = {
        id: newRunId(),
        request: parsed.request,
        sequence: parsed.sequence,
        wanted,
        named: false,
        abort: new AbortController(),
        between,
        startedAt: now(),
        counted: 0,
        failed: 0,
        inARow: 0,
        phase: 'preparing',
        exposureEndsAt: undefined,
        stopping: undefined,
        watch: undefined,
      }

      active = run
      runFile.write({ run: run.id, startedAt: run.startedAt, object: run.request.object, frameType: run.request.frameType, count: run.request.count, counted: 0 })
      emit({ kind: 'started', run: run.id, body: { rigRun: picture.rig()?.run, ...parsed.request, sequence: parsed.sequence } })
      onChange()

      return { ok: true, run: run.id, done: execute(run) }
    },

    async stop() {
      const run = active

      if (run === undefined) return false

      run.stopping ??= sender.send(abortCommand(settings.device)).then(outcome => (outcome.result === 'written' ? 'Stop pressed, abort written' : `Stop pressed, abort ${outcome.result}: ${outcome.reason}`))
      run.abort.abort()
      await run.stopping

      return true
    },

    observe(entry: Entry) {
      const run = active
      const watch = run?.watch

      if (run !== undefined && watch !== undefined) {
        const wire = readWireBody(entry.body)

        if (entry.kind === 'wire' && wire?.dir === 'in' && wire.device === settings.device) {
          if (wire.property === 'CCD_EXPOSURE') {
            watch.exposureHeardAt = now()
            if (wire.state === 'Alert') watch.alerted = true
          }

          const path = wire.elements['FILE_PATH']

          if (watch.file === undefined && announcesFrame(entry, settings.device) && typeof path === 'string' && path !== watch.previous) {
            watch.file = path
            labels.set(basename(path), { run: run.id, sequence: run.sequence, frame: run.counted + 1 })
          }
        }
      }

      changes.announce()
    },

    recoverInterrupted(): Ending | undefined {
      const found = runFile.read()

      if (found === undefined) return undefined

      const id = found.run ?? 'unknown'
      const counted = found.counted ?? 0
      const ending: Ending = { run: id, reason: 'interrupted', detail: 'Vela restarted while this run was active; it was not resumed', counted, failed: 0, at: now() }

      runFile.clear()
      last = ending
      emit({ kind: 'ended', run: id, body: { reason: ending.reason, detail: ending.detail, counted } })
      onChange()

      return ending
    },

    labelOf: (file: string) => labels.get(file),

    view(): CaptureView {
      const at = now()

      return {
        at,
        run:
          active === undefined
            ? undefined
            : {
                id: active.id,
                object: active.request.object,
                frameType: active.request.frameType,
                exposureSeconds: active.request.exposureSeconds,
                count: active.request.count,
                counted: active.counted,
                failed: active.failed,
                frame: active.request.count === undefined ? active.counted + 1 : Math.min(active.counted + 1, active.request.count),
                phase: active.phase,
                secondsLeft: active.exposureEndsAt === undefined ? undefined : Math.max(0, Math.ceil((active.exposureEndsAt - at) / 1000)),
              },
        last,
      }
    },
  }
}
