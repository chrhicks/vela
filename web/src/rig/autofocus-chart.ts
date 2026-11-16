import { checkOf, sweepOf, type Autofocus } from '../../../state/autofocus.ts'
import type { ChartProps } from '../components/Chart.tsx'
import { niceTicks } from '../components/ticks.ts'
import { unknown } from './words.ts'

export function autofocusChart(state: Autofocus): ChartProps {
  const measured = sweepOf(state).flatMap(sample => (sample.hfd === null ? [] : [{ x: -sample.position, y: sample.hfd }]))
  const top = state.positions[0]
  const bottom = state.positions.at(-1)
  const marker = state.best === undefined ? undefined : { x: -state.best, y: checkOf(state)?.hfd ?? Math.min(...measured.map(point => point.y)) }

  return {
    title: 'HFD by position',
    lines: [measured],
    yTicks: niceTicks([0, ...measured.map(point => point.y)]),
    xLabels: [top === undefined ? unknown : String(top), bottom === undefined ? unknown : String(bottom)],
    ...(marker === undefined || !Number.isFinite(marker.y) ? {} : { marker }),
  }
}
