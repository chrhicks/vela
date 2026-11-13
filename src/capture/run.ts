import { basename } from 'node:path'
import type { Measurement } from '../measure/rig.ts'
import type { LateCommand, Sender } from '../commands/sender.ts'
import { announcesFrame } from '../frames/announce.ts'
import type { Picture } from '../rig/picture.ts'
import type { Entry } from '../../state/entry.ts'
import { Result, Schema } from 'effect'
import type { FilterAnswer } from '../../state/commands.ts'
import { FilterAnswered, type RunEnding } from '../../state/entries.ts'
import { readWireBody } from '../stream/json.ts'
import { makeChanges } from './changes.ts'
import type { RunEvent } from './events.ts'
import { stepsFor, wantedOf, type Step, type Wanted } from './plan.ts'
import { parseRequest, type CaptureRequest } from './request.ts'
import type { RunFile } from './runfile.ts'

export type EndReason = RunEnding

const decodeFilterAnswered = Schema.decodeUnknownResult(FilterAnswered)

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
  readonly measureDir: string
  readonly settleMs: number
  readonly exposureSilenceMs: number
  readonly failuresInRow: number
  readonly telescope: string | undefined
  readonly filterNames: Readonly<Record<FilterAnswer, string>>
}

export interface CaptureOptions {
  readonly picture: Pick<Picture, 'property' | 'rig'>
  readonly sender: Pick<Sender, 'send' | 'late'>
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
  readonly measure: ReadonlyArray<Measurement> | undefined
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
        readonly alert: { readonly text: string; readonly seconds: number | undefined } | undefined
      }
    | undefined
  readonly last: Ending | undefined
  readonly late: ReadonlyArray<LateCommand>
}

export type Between = (frame: number, signal: AbortSignal) => Promise<string | { readonly done: string } | undefined>

export type StartResult = { readonly ok: true; readonly run: string; readonly done: Promise<void> } | { readonly ok: false; readonly reason: string }

interface Active {
  readonly id: string
  readonly request: CaptureRequest
  readonly sequence: string
  wanted: Wanted
  named: boolean
  readonly abort: AbortController
  readonly between: Between | undefined
  readonly measure: ReadonlyArray<Measurement> | undefined
  readonly startedAt: number
  counted: number
  failed: number
  inARow: number
  phase: 'preparing' | 'exposing' | 'ending'
  exposureEndsAt: number | undefined
  stopping: Promise<string> | undefined
  watch: { alerted: boolean; file: string | undefined; previous: string | undefined; exposureHeardAt: number } | undefined
  waiting: { readonly what: string; readonly since: () => number; readonly alertAfterMs: number } | undefined
  readonly refused: Map<string, string>
  paused: boolean
}

type Stop = { readonly reason: EndReason; readonly detail: string }

const abortCommand = (device: string) => ({ device, property: 'CCD_ABORT_EXPOSURE', values: { ABORT: true } })

export function makeCapture({ picture, sender, settings, runFile, nextName, now, newRunId, emit, onChange }: CaptureOptions) {
  const changes = makeChanges()
  const labels = new Map<string, FrameLabel>()
  let active: Active | undefined
  let filter: FilterAnswer | undefined
  let last: Ending | undefined
  const idleWaiters = new Set<() => void>()

  const read = (property: string) => picture.property(settings.device, property)

  function refusalToStart(request: CaptureRequest, wanted: Wanted): string | undefined {
    if (active !== undefined) return 'a capture is already running'
    if (picture.rig() === undefined) return 'the stream shows no rig connection'
    if (read('CCD_EXPOSURE') === undefined) return `${settings.device} has no CCD_EXPOSURE on the stream`

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
    for (const idle of idleWaiters) idle()
    idleWaiters.clear()

    return ending
  }

  async function wait(run: Active, what: string, alertAfterMs: number, check: () => boolean, since: number | (() => number) = now()) {
    run.waiting = { what, since: typeof since === 'number' ? () => since : since, alertAfterMs }

    try {
      return await changes.until(check, undefined, run.abort.signal)
    } finally {
      run.waiting = undefined
    }
  }

  function alertOf(run: Active, at: number) {
    const waiting = run.waiting
    const waited = waiting === undefined ? 0 : at - waiting.since()

    const parts = [
      ...[...run.refused].map(([property, reason]) => `The rig program refused ${property}: ${reason}`),
      ...(run.inARow >= settings.failuresInRow ? [`${run.inARow} exposures in a row failed`] : []),
    ]

    if (waiting !== undefined && waited >= waiting.alertAfterMs) return { text: [`Waiting for ${waiting.what}`, ...parts].join('. '), seconds: Math.round(waited / 1000) }

    return parts.length === 0 ? undefined : { text: parts.join('. '), seconds: undefined }
  }

  function stoppedOr(run: Active, stop: Stop): Stop {
    return run.abort.signal.aborted ? { reason: 'stopped', detail: 'Stop pressed' } : stop
  }

  async function apply(run: Active, step: Step): Promise<Stop | undefined> {
    const outcome = await sender.send({ device: settings.device, property: step.property, values: step.values }, run.abort.signal)

    if (outcome.result === 'unknown') return stoppedOr(run, { reason: outcome.result, detail: `${step.property}: ${outcome.reason}` })

    if (outcome.result === 'refused') {
      run.refused.set(step.property, outcome.reason)

      return undefined
    }

    run.refused.delete(step.property)

    if (step.shows !== undefined) {
      const shows = step.shows
      await wait(run, `the stream to show ${step.property}`, settings.settleMs, () => shows(read))
    }

    return run.abort.signal.aborted ? { reason: 'stopped', detail: 'Stop pressed' } : undefined
  }

  async function prepare(run: Active, first: boolean): Promise<Stop | undefined> {
    run.phase = 'preparing'
    onChange()

    await wait(run, 'the camera to finish its last exposure', settings.settleMs, () => read('CCD_EXPOSURE')?.state !== 'Busy')

    if (run.abort.signal.aborted) return { reason: 'stopped', detail: 'Stop pressed' }

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

  type Frame = { readonly frame: 'file'; readonly path: string } | { readonly frame: 'failed'; readonly why: 'alert' } | { readonly frame: 'stop'; readonly stop: Stop } | { readonly frame: 'paused' }

  async function expose(run: Active): Promise<Frame> {
    const watch = { alerted: false, file: undefined as string | undefined, previous: read('CCD_FILE_PATH')?.values['FILE_PATH'] as string | undefined, exposureHeardAt: now() }
    const exposureMs = run.request.exposureSeconds * 1000

    run.watch = watch
    run.phase = 'exposing'

    const outcome = await sender.send({ device: settings.device, property: 'CCD_EXPOSURE', values: { CCD_EXPOSURE_VALUE: run.request.exposureSeconds } }, run.abort.signal)

    if (outcome.result === 'refused') {
      run.watch = undefined
      await wait(run, `you: the rig program refused CCD_EXPOSURE (${outcome.reason})`, 0, () => false)

      return { frame: 'stop', stop: { reason: 'stopped', detail: 'Stop pressed' } }
    }

    if (outcome.result !== 'written') {
      run.watch = undefined

      return { frame: 'stop', stop: stoppedOr(run, { reason: outcome.result, detail: `CCD_EXPOSURE: ${outcome.reason}` }) }
    }

    run.exposureEndsAt = now() + exposureMs
    onChange()

    await wait(run, 'word from the camera during the exposure', settings.exposureSilenceMs, () => watch.file !== undefined || watch.alerted || run.paused, () => watch.exposureHeardAt)

    run.watch = undefined
    run.exposureEndsAt = undefined

    if (watch.file !== undefined) return { frame: 'file', path: watch.file }
    if (run.abort.signal.aborted) return { frame: 'stop', stop: { reason: 'stopped', detail: 'Stop pressed' } }
    if (run.paused) return { frame: 'paused' }

    await sender.send(abortCommand(settings.device), run.abort.signal)

    return { frame: 'failed', why: 'alert' }
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

      const next = await run.between?.(run.counted, run.abort.signal)

      if (run.abort.signal.aborted) return finishWith(run, { reason: 'stopped', detail: 'Stop pressed' })
      if (typeof next === 'string') return finishWith(run, { reason: 'refused', detail: next })
      if (next !== undefined) return finishWith(run, { reason: 'done', detail: next.done })

      if (run.paused) {
        await changes.until(() => !run.paused, undefined, run.abort.signal)

        if (run.abort.signal.aborted) return finishWith(run, { reason: 'stopped', detail: 'Stop pressed' })

        await sender.send(abortCommand(settings.device), run.abort.signal)
      }

      const result = await expose(run)

      if (result.frame === 'stop') return finishWith(run, result.stop)
      if (result.frame === 'paused') continue

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
      }

      onChange()
      if (run.abort.signal.aborted) return finishWith(run, { reason: 'stopped', detail: 'Stop pressed' })
    }

    await finishWith(run, { reason: 'done', detail: `${run.counted} frames` })
  }

  async function finishWith(run: Active, stop: Stop) {
    run.phase = 'ending'
    onChange()

    const stopped = run.stopping === undefined ? undefined : await Promise.race([run.stopping, Promise.resolve('Stop pressed, abort sent')])

    finish(run, stopped === undefined || stop.reason !== 'stopped' ? stop : { reason: 'stopped', detail: stopped })
  }

  return {
    start(json: unknown, between?: Between, measure?: ReadonlyArray<Measurement>): StartResult {
      const parsed = parseRequest(json)

      if (!parsed.ok) return parsed

      const wanted = wantedOf(parsed.request, parsed.sequence, measure === undefined ? settings.spoolDir : settings.measureDir, settings.telescope, filter === undefined ? undefined : settings.filterNames[filter])
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
        measure,
        startedAt: now(),
        counted: 0,
        failed: 0,
        inARow: 0,
        phase: 'preparing',
        exposureEndsAt: undefined,
        stopping: undefined,
        watch: undefined,
        waiting: undefined,
        refused: new Map(),
        paused: false,
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

      return true
    },

    observe(entry: Entry) {
      if (entry.kind === 'vela.filter') filter = Result.match(decodeFilterAnswered(entry), { onSuccess: answered => answered.body.filter, onFailure: () => undefined })

      const run = active
      const watch = run?.watch

      if (run !== undefined && watch !== undefined) {
        const wire = readWireBody(entry)

        if (entry.kind === 'wire' && wire?.dir === 'in' && wire.device === settings.device) {
          if (wire.property === 'CCD_EXPOSURE') {
            watch.exposureHeardAt = now()
            if (wire.state === 'Alert') watch.alerted = true
          }

          const path = wire.elements['FILE_PATH']

          if (watch.file === undefined && announcesFrame(entry, settings.device) && typeof path === 'string' && path !== watch.previous) {
            watch.file = path
            labels.set(basename(path), { run: run.id, sequence: run.sequence, frame: run.counted + 1, measure: run.measure })
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

    pause(): boolean {
      const run = active

      if (run === undefined) return false

      run.paused = true
      if (run.phase === 'exposing') void sender.send(abortCommand(settings.device), run.abort.signal)
      changes.announce()
      onChange()

      return true
    },

    resume(): void {
      const run = active

      if (run === undefined || !run.paused) return

      run.paused = false
      changes.announce()
      onChange()
    },

    whenIdle(): Promise<void> {
      return active === undefined ? Promise.resolve() : new Promise(resolve => void idleWaiters.add(resolve))
    },

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
                alert: alertOf(active, at),
              },
        last,
        late: sender.late(at),
      }
    },
  }
}
