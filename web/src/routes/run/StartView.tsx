import type { StartStep, StepOutcome } from '../../../../state/entries.ts'
import type { Starting, StepReport } from '../../../../state/starting.ts'
import { ActionLink } from '../../components/ActionLink.tsx'
import { Caption } from '../../components/Caption.tsx'
import { CommandPill } from '../../components/CommandPill.tsx'
import { Page } from '../../components/Page.tsx'
import { PageHeader } from '../../components/PageHeader.tsx'
import { Readings, type Reading } from '../../components/Readings.tsx'
import { clockTime } from '../../rig/clock.ts'
import { refusalWords } from '../../rig/words.ts'
import layout from './layout.module.css'

const stepWords: Readonly<Record<StartStep, string>> = {
  home: 'Home',
  'stop-guiding': 'Stop guiding',
  centre: 'Slew and centre',
  autofocus: 'Autofocus',
  guiding: 'Guiding',
  capture: 'Capture',
}

const outcomeWords: Readonly<Record<StepOutcome, string>> = { started: 'UNDER WAY', done: 'DONE', failed: 'FAILED', stopped: 'STOPPED' }

const steps: ReadonlyArray<StartStep> = ['home', 'stop-guiding', 'centre', 'autofocus', 'guiding', 'capture']

function valueOf(report: StepReport | undefined) {
  if (report === undefined) return 'WAITING'
  if (report.refusal === undefined) return outcomeWords[report.outcome]

  const { happened, toDo } = refusalWords(report.refusal)

  return [outcomeWords[report.outcome], happened, ...(toDo === undefined ? [] : [toDo])].join(' · ').toUpperCase()
}

export function startRows(starting: Starting): ReadonlyArray<Reading> {
  return steps.map(step => {
    const report = starting.steps.find(reported => reported.step === step)

    return { label: stepWords[step], value: valueOf(report), attention: report?.outcome === 'failed' }
  })
}

export function StartView({ starting }: { readonly starting: Starting }) {
  return (
    <Page width="wide">
      <PageHeader title="Starting" facts={[starting.target.name, `Since ${clockTime(starting.startedAt)}`]}>
        <ActionLink to="/controls">Controls</ActionLink>

        <CommandPill request={{ command: 'stop' }}>Stop</CommandPill>
      </PageHeader>

      <div className={layout.night}>
        <div className={layout.column}>
          <div className={layout.first}>
            <Caption>Start</Caption>
          </div>

          <div className={layout.first}>
            <Readings rows={startRows(starting)} />
          </div>
        </div>
      </div>
    </Page>
  )
}
