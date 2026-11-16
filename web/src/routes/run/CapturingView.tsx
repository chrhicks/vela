import { useState } from 'react'

import { ActionButton } from '../../components/ActionButton.tsx'
import { ActionLink } from '../../components/ActionLink.tsx'
import { CommandPill } from '../../components/CommandPill.tsx'
import { Alert } from '../../components/Alert.tsx'
import { Choices } from '../../components/Choices.tsx'
import { Page } from '../../components/Page.tsx'
import { PageHeader } from '../../components/PageHeader.tsx'
import { Picture } from '../../components/Picture.tsx'
import { Readings } from '../../components/Readings.tsx'
import { StatusLine } from '../../components/StatusLine.tsx'
import layout from './layout.module.css'
import type { Capturing } from './capturing.ts'
import { Trends } from './Trends.tsx'
import { TrendWindow, type TrendWindowName } from './TrendWindow.tsx'

interface CapturingViewProps {
  readonly run: Capturing
}

type Shown = 'latest' | 'stack'

export function CapturingView({ run }: CapturingViewProps) {
  const [shown, setShown] = useState<Shown>('latest')
  const [trendWindow, setTrendWindow] = useState<TrendWindowName>('hour')

  return (
    <Page width="wide">
      <PageHeader title={`Capturing ${run.frame}`} facts={run.facts}>
        <ActionLink to="/?pick">Change target</ActionLink>
        <ActionLink to="/controls">Controls</ActionLink>

        <span className={layout.wideOnly}>
          <CommandPill request={{ command: 'stopForTheNight' }}>Stop for the night</CommandPill>
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
            <Choices
              name="Picture"
              choices={[
                { value: 'latest', label: 'Latest' },
                { value: 'stack', label: 'Stack' },
              ]}
              chosen={shown}
              onChoose={setShown}
            />
          </div>

          <div className={`${layout.latestPicture} ${layout.first}`}>
            <Picture label="Latest frame" detail={run.latest.detail} to={`/frame/${run.frame}`}>
              {run.latest.picture === undefined ? null : <img src={run.latest.picture} alt={`Frame ${run.frame}`} className={layout.frameImage} />}
            </Picture>
          </div>

          <div className={layout.second}>
            <Readings rows={run.latest.stats} />
          </div>
        </div>

        <div className={layout.column}>
          <div className={`${layout.stackPicture} ${layout.first}`}>
            <Picture label="Stack so far" detail="Not built yet">
              {null}
            </Picture>
          </div>
        </div>

        <div className={layout.column}>
          <div className={layout.fifth}>
            <TrendWindow shown={trendWindow} onChoose={setTrendWindow} />
          </div>

          <div className={layout.fifth}>
            <Trends {...run.trendWindows[trendWindow]} />
          </div>
        </div>

        <div className={`${layout.phoneOnly} ${layout.last}`}>
          <CommandPill request={{ command: 'stopForTheNight' }}>Stop for the night</CommandPill>
        </div>
      </div>
    </Page>
  )
}
