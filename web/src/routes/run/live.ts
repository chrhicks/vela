import type { Frame } from '../../../../state/frames.ts'
import type { Run } from '../../../../state/run.ts'
import type { Reading } from '../../components/Readings.tsx'
import type { Capturing } from './stub.ts'

const unknown = '—'

const clock = (at: number, withSeconds = false) =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(withSeconds ? { second: '2-digit' } : {}), hour12: false })

const fixed = (value: number | null, digits: number, unit = '') => (value === null ? unknown : `${value.toFixed(digits)}${unit}`)

const latestMeasured = (frames: ReadonlyArray<Frame>) => [...frames].reverse().find(frame => frame.measurements !== undefined)

function latestStats(frame: Frame | undefined): ReadonlyArray<Reading> {
  const measured = frame?.measurements

  return [
    { label: 'HFD', value: measured === undefined ? unknown : fixed(measured.hfdPixels, 2, ' px') },
    { label: 'Stars', value: measured === undefined ? unknown : fixed(measured.stars, 0) },
    { label: 'Sky', value: measured === undefined ? unknown : fixed(measured.sky, 0) },
    { label: 'Noise', value: measured === undefined ? unknown : fixed(measured.noise, 1) },
    { label: 'Off centre', value: unknown },
    { label: 'Vs baseline', value: unknown },
  ]
}

export function liveCapturing(run: Run, frames: ReadonlyArray<Frame>, placeholder: Capturing): Capturing {
  const latest = latestMeasured(frames)

  return {
    ...placeholder,
    frame: run.frames,
    facts: [run.object, `${run.exposureSeconds} s`, `Since ${clock(run.startedAt)}`, run.count === undefined ? 'Until stopped' : `${run.count} frames`],
    latest: {
      detail: latest === undefined ? unknown : `${run.frames} · ${clock(latest.keptAt, true)}`,
      stats: latestStats(latest),
    },
  }
}
