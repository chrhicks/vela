import { Schema } from 'effect'
import { checkOf } from './autofocus.ts'
import { RunId, type RigEntry } from './entries.ts'
import { Check, CheckedFrames, FirstFramesVerdict, type FirstFramesLimits, type Verdict } from './first-frames-check.ts'
import type { Frame, Measurements } from './frames.ts'
import type { RigState } from './rig.ts'
import type { Run } from './run.ts'

export const FirstFramesChecked = Schema.Struct({ run: RunId, verdict: FirstFramesVerdict, frames: CheckedFrames, checks: Schema.Array(Check), at: Schema.Number })

export type FirstFramesChecked = typeof FirstFramesChecked.Type

export function firstFramesChecked(state: FirstFramesChecked | undefined, entry: RigEntry): FirstFramesChecked | undefined {
  return entry.kind === 'vela.first-frames' ? { ...entry.body, at: entry.at } : state
}

export interface Seen {
  readonly run: Run | undefined
  readonly frames: ReadonlyArray<Frame>
  readonly focusedPixels: number | undefined
  readonly filter: 'in' | 'out' | undefined
  readonly camera: { readonly Gain: number; readonly Offset: number } | undefined
  readonly guiding: { readonly activity?: string | undefined; readonly averagePixels?: number | undefined }
}

export interface FirstFrames {
  readonly stage: 'settling' | 'checking' | 'passed' | 'poor'
  readonly frames: number
  readonly checked: typeof CheckedFrames.Type
  readonly checks: ReadonlyArray<Check>
}

const middle = (values: ReadonlyArray<number>) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

const known = (values: ReadonlyArray<number | null>) => values.filter(value => value !== null)

const judged = (good: boolean | undefined): Verdict => (good === undefined ? 'not-judged' : good ? 'ok' : 'poor')

const given = <Key extends string>(key: Key, value: number | undefined) => (value === undefined ? {} : { [key]: value })

function checksOf(seen: Seen, measured: ReadonlyArray<Measurements>, limits: FirstFramesLimits): ReadonlyArray<Check> {
  const stars = known(measured.map(frame => frame.stars))
  const sizes = known(measured.map(frame => frame.hfdPixels))
  const stretches = known(measured.map(frame => frame.elongation))
  const hfdPixels = middle(sizes)
  const { focusedPixels, camera, run, filter } = seen
  const elongation = stretches.length === 0 ? undefined : Math.max(...stretches)
  const asSet = run?.gain === undefined || run.offset === undefined || camera === undefined ? undefined : camera.Gain === run.gain && camera.Offset === run.offset
  const { activity, averagePixels } = seen.guiding

  return [
    { check: 'stars', verdict: judged(measured.length === 0 ? undefined : stars.length === measured.length && stars.every(count => count > 0)), ...given('stars', middle(stars)) },
    { check: 'focus', verdict: judged(hfdPixels === undefined || focusedPixels === undefined ? undefined : hfdPixels <= focusedPixels * limits.focusRatio), ...given('hfdPixels', hfdPixels), ...given('focusedPixels', focusedPixels) },
    { check: 'trailing', verdict: judged(elongation === undefined ? undefined : elongation < limits.trailedElongation), ...given('elongation', elongation) },
    { check: 'sky', verdict: 'not-judged', ...given('sky', middle(measured.map(frame => frame.sky))) },
    { check: 'filter', verdict: 'not-judged', ...(filter === undefined ? {} : { filter }) },
    { check: 'settings', verdict: judged(asSet), ...(asSet === undefined ? {} : { asSet }) },
    { check: 'guiding', verdict: judged(activity === undefined ? undefined : activity === 'guiding'), ...(activity === undefined ? {} : { activity }), ...given('averagePixels', averagePixels) },
  ]
}

export function framesOf(run: Run, frames: ReadonlyArray<Frame>): ReadonlyArray<Frame> {
  return run.sequence === undefined ? [] : frames.filter(frame => frame.sequence === run.sequence && frame.keptAt >= run.startedAt).sort((a, b) => a.keptAt - b.keptAt)
}

export function firstFrames(seen: Seen, limits: FirstFramesLimits): FirstFrames | undefined {
  const { run } = seen

  if (run === undefined || run.frameType !== 'light' || run.sequence === undefined) return undefined

  const kept = framesOf(run, seen.frames)
  const checked = { from: limits.skippedFrames + 1, to: limits.skippedFrames + limits.checkedFrames }
  const measured = kept.slice(limits.skippedFrames, checked.to).flatMap(frame => (frame.measurements === undefined ? [] : [frame.measurements]))
  const checks = checksOf(seen, measured, limits)

  return {
    stage: kept.length <= limits.skippedFrames ? 'settling' : measured.length < limits.checkedFrames ? 'checking' : checks.some(check => check.verdict === 'poor') ? 'poor' : 'passed',
    frames: kept.length,
    checked,
    checks,
  }
}

export const seenIn = (rig: Pick<RigState, 'run' | 'frames' | 'autofocus' | 'operations' | 'devices' | 'guiding'>): Seen => ({
  run: rig.run,
  frames: rig.frames,
  focusedPixels: checkOf(rig.autofocus)?.hfd ?? undefined,
  filter: rig.operations.filter,
  camera: rig.devices.primary.CCD_CONTROLS?.values,
  guiding: rig.guiding,
})
