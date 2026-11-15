import type { FirstFrames } from '../../../../state/first-frames.ts'
import type { Run } from '../../../../state/run.ts'
import type { Starting } from '../../../../state/starting.ts'
import { ActionLink } from '../../components/ActionLink.tsx'
import { Caption } from '../../components/Caption.tsx'
import { CommandPill } from '../../components/CommandPill.tsx'
import { Page } from '../../components/Page.tsx'
import { PageHeader } from '../../components/PageHeader.tsx'
import { Readings } from '../../components/Readings.tsx'
import { Checks } from './Checks.tsx'
import { checkRows, frameRows } from './first-frames.ts'
import layout from './layout.module.css'
import { startRows } from './StartView.tsx'

interface FirstFramesViewProps {
  readonly run: Run
  readonly found: FirstFrames
  readonly starting: Starting | undefined
}

export function FirstFramesView({ run, found, starting }: FirstFramesViewProps) {
  return (
    <Page width="wide">
      <PageHeader title="First frames" facts={[run.object, `${run.exposureSeconds} s`, `Frame ${found.frames}`]}>
        <ActionLink to="/controls">Controls</ActionLink>

        <CommandPill request={{ command: 'stop' }}>Stop</CommandPill>
      </PageHeader>

      <div className={layout.night}>
        <div className={layout.column}>
          <div className={layout.first}>
            <Caption>Start</Caption>
          </div>

          <div className={layout.first}>
            <Readings rows={[...(starting === undefined ? [] : startRows(starting)), ...frameRows(found)]} />
          </div>
        </div>

        <div className={layout.column}>
          <div className={layout.second}>
            <Caption>First frames</Caption>
          </div>

          <div className={layout.second}>
            <Checks checks={checkRows(found.checks)} />
          </div>
        </div>
      </div>
    </Page>
  )
}
