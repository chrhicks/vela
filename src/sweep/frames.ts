import type { Between, StartResult } from '../capture/run.ts'
import type { Measured, Measurement } from '../measure/rig.ts'
import type { Picture } from '../rig/picture.ts'
import { operationObjects } from '../../state/entries.ts'

export type Taken =
  | { readonly taken: 'measured'; readonly file: string; readonly answer: Extract<Measured, { readonly result: 'measured' }> }
  | { readonly taken: 'refused'; readonly file: string; readonly reason: string }
  | { readonly taken: 'failed'; readonly reason: string }
  | { readonly taken: 'ended'; readonly reason: string }

export interface SweepFramesOptions {
  readonly picture: Pick<Picture, 'property'>
  readonly capture: {
    readonly start: (request: unknown, between: Between, measure: ReadonlyArray<Measurement>, keep: boolean) => StartResult
    readonly labelOf: (file: string) => { readonly run: string; readonly frame: number } | undefined
    readonly stop: () => Promise<boolean>
  }
  readonly camera: string
  readonly measure: ReadonlyArray<Measurement>
  readonly onKept: () => void
}

type Result = { readonly ok: true } | { readonly ok: false; readonly reason: string }

interface Taking {
  readonly resolve: (taken: Taken) => void
  between: number | undefined
}

export function makeSweepFrames({ picture, capture, camera, measure, onKept }: SweepFramesOptions) {
  let run: string | undefined
  let taking: Taking | undefined
  let problems: Array<string> = []
  const listeners = new Set<() => void>()

  const announce = () => {
    for (const listener of [...listeners]) listener()
  }

  const until = (check: () => boolean, signal: AbortSignal) =>
    new Promise<boolean>(resolve => {
      const done = (seen: boolean) => {
        listeners.delete(recheck)
        signal.removeEventListener('abort', aborted)
        resolve(seen)
      }
      const recheck = () => {
        if (check()) done(true)
      }
      const aborted = () => done(false)

      if (signal.aborted) return resolve(false)
      if (check()) return resolve(true)

      listeners.add(recheck)
      signal.addEventListener('abort', aborted)
    })

  const settle = (taken: Taken) => {
    const waiting = taking

    taking = undefined
    waiting?.resolve(taken)
    announce()
  }

  const between: Between = async (frame, signal) => {
    if (taking?.between === frame) settle({ taken: 'failed', reason: 'the exposure did not finish' })

    await until(() => taking !== undefined && taking.between === undefined, signal)

    if (taking !== undefined) taking.between = frame

    return undefined
  }

  return {
    begin(exposureSeconds: number): Result {
      const controls = picture.property(camera, 'CCD_CONTROLS')?.values

      if (typeof controls?.['Gain'] !== 'number' || typeof controls['Offset'] !== 'number') return { ok: false, reason: `${camera} has no gain and offset on the stream` }

      const started = capture.start({ object: operationObjects.sweep, frameType: 'light', exposureSeconds, gain: controls['Gain'], offset: controls['Offset'], cooler: 'keep' }, between, measure, true)

      if (!started.ok) return started

      run = started.run
      problems = []

      const mine = started.run

      void started.done.then(ending => {
        if (run !== mine) return

        run = undefined
        settle({ taken: 'ended', reason: `the capture run ended: ${ending.detail}` })
      })

      return { ok: true }
    },

    take(): Promise<Taken> {
      return new Promise(resolve => {
        if (run === undefined) return resolve({ taken: 'ended', reason: 'no capture run is going' })

        taking = { resolve, between: undefined }
        announce()
      })
    },

    measured(answer: Measured) {
      const label = capture.labelOf(answer.file)

      if (label === undefined || label.run !== run || taking?.between === undefined || label.frame !== taking.between + 1) return

      settle(answer.result === 'measured' ? { taken: 'measured', file: answer.file, answer } : { taken: 'refused', file: answer.file, reason: answer.reason })
      onKept()
    },

    notKept(file: string, reason: string) {
      if (run !== undefined && capture.labelOf(file)?.run === run) problems.push(`${file} was measured but not kept: ${reason}`)
    },

    problems(): ReadonlyArray<string> {
      const found = problems

      problems = []

      return found
    },

    async end(): Promise<void> {
      const ending = run

      run = undefined
      settle({ taken: 'ended', reason: 'the sweep ended' })

      if (ending !== undefined) await capture.stop()

      onKept()
    },
  }
}
