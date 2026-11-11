import { useState } from 'react'

import { ActionButton } from '../../components/ActionButton.tsx'
import { ActionLink } from '../../components/ActionLink.tsx'
import { Alert } from '../../components/Alert.tsx'
import { Log } from '../../components/Log.tsx'
import { Page } from '../../components/Page.tsx'
import { PageHeader } from '../../components/PageHeader.tsx'
import { Picture } from '../../components/Picture.tsx'
import { PillLink } from '../../components/PillLink.tsx'
import { Readings } from '../../components/Readings.tsx'
import { StatusLine } from '../../components/StatusLine.tsx'
import { StubSky } from '../../stub/StubSky.tsx'
import layout from './layout.module.css'
import type { Capturing } from './stub.ts'
import { Trends } from './Trends.tsx'
import { TrendWindow } from './TrendWindow.tsx'

interface CapturingViewProps {
  readonly run: Capturing
}

type Shown = 'latest' | 'stack'

export function CapturingView({ run }: CapturingViewProps) {
  const [shown, setShown] = useState<Shown>('latest')

  return (
    <Page width="wide">
      <PageHeader title={`Capturing ${run.frame}`} facts={run.facts}>
        <ActionLink to="/?scene=ready">Change target</ActionLink>
        <ActionLink to="/controls">Controls</ActionLink>

        <span className={layout.wideOnly}>
          <PillLink to="/?scene=over">Stop for the night</PillLink>
        </span>
      </PageHeader>

      {run.alert === undefined ? null : (
        <Alert title={run.alert.title} facts={run.alert.facts}>
          {run.alert.fixes.map(fix =>
            fix.to === undefined ? (
              <ActionButton key={fix.label}>{fix.label}</ActionButton>
            ) : (
              <ActionLink key={fix.label} to={fix.to}>
                {fix.label}
              </ActionLink>
            ),
          )}
        </Alert>
      )}

      <div className={layout.night} data-shown={shown}>
        <div className={`${layout.across} ${layout.fourth}`}>
          <StatusLine items={run.rig} />
        </div>

        <div className={layout.column}>
          <div className={`${layout.phoneOnly} ${layout.tabs} ${layout.first}`}>
            <ActionButton pressed={shown === 'latest'} onPress={() => setShown('latest')}>
              Latest
            </ActionButton>

            <ActionButton pressed={shown === 'stack'} onPress={() => setShown('stack')}>
              Stack
            </ActionButton>
          </div>

          <div className={`${layout.latestPicture} ${layout.first}`}>
            <Picture label="Latest frame" detail={run.latest.detail}>
              <StubSky seed={run.frame} glow="faint" />
            </Picture>
          </div>

          <div className={layout.second}>
            <Readings rows={run.latest.stats} />
          </div>
        </div>

        <div className={layout.column}>
          <div className={`${layout.stackPicture} ${layout.first}`}>
            <Picture label="Stack so far" detail={run.stack.detail}>
              <StubSky seed={7} glow="bright" />
            </Picture>
          </div>

          <div className={layout.third}>
            <Readings rows={run.stack.counts} />
          </div>

          {run.handled.length === 0 ? null : (
            <div className={layout.sixth}>
              <Log heading="Handled without you" lines={run.handled} />
            </div>
          )}
        </div>

        <div className={layout.column}>
          <div className={layout.fifth}>
            <TrendWindow />
          </div>

          <div className={layout.fifth}>
            <Trends trends={run.trends} span={run.span} />
          </div>
        </div>

        <div className={`${layout.phoneOnly} ${layout.last}`}>
          <PillLink to="/?scene=over">Stop for the night</PillLink>
        </div>
      </div>
    </Page>
  )
}
