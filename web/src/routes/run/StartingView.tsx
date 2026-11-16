import type { Autofocus } from '../../../../state/autofocus.ts'
import { framesOf, type FirstFrames } from '../../../../state/first-frames.ts'
import { previewAddress, type Frame } from '../../../../state/frames.ts'
import type { Run } from '../../../../state/run.ts'
import type { Starting } from '../../../../state/starting.ts'
import { ActionLink } from '../../components/ActionLink.tsx'
import { Caption } from '../../components/Caption.tsx'
import { Chart } from '../../components/Chart.tsx'
import { CommandPill } from '../../components/CommandPill.tsx'
import { Page } from '../../components/Page.tsx'
import { PageHeader } from '../../components/PageHeader.tsx'
import { Picture } from '../../components/Picture.tsx'
import { autofocusChart } from '../../rig/autofocus-chart.ts'
import { clockSeconds, useLocalNow } from '../../rig/clock.ts'
import { unknown } from '../../rig/words.ts'
import { Checks } from './Checks.tsx'
import { checkRows, pendingCheckRows } from './first-frames.ts'
import layout from './layout.module.css'
import { clockDuration, exposing, focusProgress, runningStep, startingRows, type StepRow } from './starting.ts'
import styles from './StartingView.module.css'

interface StartingViewProps {
  readonly starting: Starting | undefined
  readonly run: Run | undefined
  readonly found: FirstFrames | undefined
  readonly autofocus: Autofocus
  readonly frames: ReadonlyArray<Frame>
}

const stepNames = { home: 'Home', 'stop-guiding': 'Stop guiding', centre: 'Slew and centre', autofocus: 'Autofocus', guiding: 'Guiding', capture: 'Capture' } as const

function Steps({ rows }: { readonly rows: ReadonlyArray<StepRow> }) {
  return (
    <dl className={styles.steps}>
      {rows.map(row => (
        <div key={row.label} className={styles.step} data-tone={row.tone}>
          <dt className={styles.label}>{row.label}</dt>
          <dd className={styles.value}>{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function Count({ big, small, done }: { readonly big: string; readonly small: string; readonly done?: number }) {
  return (
    <div className={styles.count}>
      <span className={styles.big}>{big}</span>
      <span className={styles.small}>{small}</span>
      {done === undefined ? null : (
        <span className={styles.bar}>
          <span className={styles.filled} style={{ width: `${Math.round(Math.min(1, Math.max(0, done)) * 100)}%` }} />
        </span>
      )}
    </div>
  )
}

function StepPicture({ starting, run, autofocus, frames, now }: Omit<StartingViewProps, 'found'> & { readonly now: number }) {
  const step = runningStep(starting)

  if (step === 'autofocus') {
    return (
      <Picture label="Autofocus" detail={focusProgress(autofocus) ?? 'Starting'}>
        <div className={styles.chart}>
          <Chart {...autofocusChart(autofocus)} />
        </div>
      </Picture>
    )
  }

  if (step !== undefined) {
    const since = starting?.steps.find(report => report.step === step)?.since ?? now

    return (
      <Picture label={stepNames[step]} detail="Under way">
        <Count big={clockDuration(now - since)} small="so far" />
      </Picture>
    )
  }

  if (run === undefined) return <Picture label="Latest frame" detail={unknown}>{null}</Picture>

  const latest = framesOf(run, frames).at(-1)
  const next = exposing(run, frames, now)

  if (latest === undefined) {
    return (
      <Picture label={`Frame ${next.frame}`} detail={`Exposing · ${clockSeconds(run.startedAt)}`}>
        <Count big={next.leftMs > 0 ? clockDuration(next.leftMs) : 'Saving'} small={next.leftMs > 0 ? `left of ${run.exposureSeconds} s` : 'picture next'} done={1 - next.leftMs / next.exposureMs} />
      </Picture>
    )
  }

  return (
    <Picture label="Latest frame" detail={`${next.frame - 1} · ${clockSeconds(latest.keptAt)}`}>
      <img src={previewAddress(latest)} alt={`Frame ${next.frame - 1}`} className={layout.frameImage} />
    </Picture>
  )
}

export function StartingView({ starting, run, found, autofocus, frames }: StartingViewProps) {
  const now = useLocalNow(1000)
  const rows = startingRows(starting, run, found, autofocus, frames, now)
  const at = rows.findIndex(row => row.tone === 'running')
  const facts = [
    ...(run === undefined ? [] : [`${run.exposureSeconds} s`, run.count === undefined ? 'Until stopped' : `${run.count} frames`]),
    ...(starting === undefined ? [] : [`Since ${clockSeconds(starting.startedAt)}`]),
    ...(at < 0 ? [] : [`Step ${at + 1} of ${rows.length}`]),
  ]
  const name = starting?.target.name ?? run?.object

  return (
    <Page width="wide">
      <PageHeader title={name === undefined ? 'Starting' : `Starting ${name}`} facts={facts}>
        <ActionLink to="/controls">Controls</ActionLink>

        <CommandPill request={{ command: 'stop' }}>Stop</CommandPill>
      </PageHeader>

      <div className={layout.night}>
        <div className={layout.column}>
          <div className={layout.first}>
            <StepPicture starting={starting} run={run} autofocus={autofocus} frames={frames} now={now} />
          </div>
        </div>

        <div className={layout.column}>
          <div className={layout.second}>
            <Caption>Start</Caption>
          </div>

          <div className={layout.second}>
            <Steps rows={rows} />
          </div>
        </div>

        <div className={layout.column}>
          <div className={layout.third}>
            <Caption>First frames</Caption>
          </div>

          <div className={layout.third}>
            <Checks checks={found === undefined ? pendingCheckRows : checkRows(found.checks)} />
          </div>

          {found === undefined ? null : (
            <div className={layout.third}>
              <Caption>{`Checked on frames ${found.checked.from} to ${found.checked.to}`}</Caption>
            </div>
          )}
        </div>
      </div>
    </Page>
  )
}
