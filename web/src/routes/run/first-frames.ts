import type { Check as Checked, Verdict } from '../../../../state/first-frames-check.ts'
import type { FirstFrames, FirstFramesChecked } from '../../../../state/first-frames.ts'
import type { Reading } from '../../components/Readings.tsx'
import { clockTime } from '../../rig/clock.ts'
import { guiderWords, unknown } from '../../rig/words.ts'
import type { Check } from './Checks.tsx'
import type { RunAlert } from './capturing.ts'

const verdictWords: Readonly<Record<Verdict, string>> = { ok: 'OK', poor: 'POOR', 'not-judged': '' }

const labels: Readonly<Record<Checked['check'], string>> = {
  stars: 'Stars',
  focus: 'HFD vs focus',
  trailing: 'Elongation',
  sky: 'Sky',
  filter: 'Filter',
  settings: 'Settings',
  guiding: 'Guiding',
}

const shown = (value: number | undefined, digits: number) => (value === undefined ? unknown : value.toFixed(digits))

const activityWord = (activity: string | undefined) => Object.entries(guiderWords).find(([name]) => name === activity)?.[1] ?? unknown

function valueOf(check: Checked): string {
  switch (check.check) {
    case 'stars':
      return shown(check.stars, 0)
    case 'focus':
      return `${shown(check.hfdPixels, 1)} / ${shown(check.focusedPixels, 1)}`
    case 'trailing':
      return shown(check.elongation, 2)
    case 'sky':
      return shown(check.sky, 0)
    case 'filter':
      return check.filter === undefined ? unknown : check.filter
    case 'settings':
      return check.asSet === undefined ? unknown : check.asSet ? 'As set' : 'Changed'
    case 'guiding':
      return check.averagePixels === undefined ? activityWord(check.activity) : `${check.averagePixels.toFixed(2)} px`
  }
}

export const checkRows = (checks: ReadonlyArray<Checked>): ReadonlyArray<Check> =>
  checks.map(check => ({ label: labels[check.check], value: valueOf(check), verdict: verdictWords[check.verdict], attention: check.verdict === 'poor' }))

export function frameRows({ stage, checked }: FirstFrames): ReadonlyArray<Reading> {
  const settling = stage === 'settling'

  return [
    { label: `Frames 1 to ${checked.from - 1}`, value: settling ? 'SETTLING' : 'SKIPPED' },
    { label: `Frames ${checked.from} to ${checked.to}`, value: settling ? 'WAITING' : stage === 'checking' ? 'CHECKING' : 'CHECKED' },
  ]
}

export const verdictFact = ({ verdict, at }: FirstFramesChecked) => `First frames ${verdict === 'passed' ? 'OK' : 'poor'} ${clockTime(at)}`

export function poorAlert({ verdict, checks, frames }: FirstFramesChecked): RunAlert | undefined {
  if (verdict === 'passed') return undefined

  return {
    title: 'First frames poor',
    facts: [`Frames ${frames.from} to ${frames.to}`, ...checks.filter(check => check.verdict === 'poor').map(check => `${labels[check.check]} ${valueOf(check)}`)],
    fixes: [{ label: 'Controls', to: '/controls' }],
  }
}
