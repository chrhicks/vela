import { ActionLink } from '../../components/ActionLink.tsx'
import { Caption } from '../../components/Caption.tsx'
import { Facts } from '../../components/Facts.tsx'
import { Page } from '../../components/Page.tsx'
import { PageHeader } from '../../components/PageHeader.tsx'
import { Picture } from '../../components/Picture.tsx'
import { PillLink } from '../../components/PillLink.tsx'
import { Readings } from '../../components/Readings.tsx'
import { StubSky } from '../../stub/StubSky.tsx'
import { useStubAdvance } from '../../stub/useStubAdvance.ts'
import { Checks } from './Checks.tsx'
import layout from './layout.module.css'
import { starting, startingSeconds } from './stub.ts'

export function StartingView() {
  useStubAdvance('/?scene=capturing', startingSeconds)

  return (
    <Page width="wide">
      <PageHeader title="Leave the screen" facts={starting.facts}>
        <ActionLink to="/controls">Controls</ActionLink>

        <span className={layout.wideOnly}>
          <PillLink to="/?scene=over">Stop for the night</PillLink>
        </span>
      </PageHeader>

      <div className={layout.night}>
        <div className={layout.column}>
          <div className={layout.first}>
            <Picture label="Latest frame" detail={starting.latestDetail} to="/frame/5">
              <StubSky seed={5} glow="faint" />
            </Picture>
          </div>
        </div>

        <div className={layout.column}>
          <div className={layout.third}>
            <Caption>Start</Caption>
          </div>

          <div className={layout.third}>
            <Readings rows={starting.sequence} />
          </div>
        </div>

        <div className={layout.column}>
          <div className={layout.second}>
            <Caption>First frames</Caption>
          </div>

          <div className={layout.second}>
            <Checks checks={starting.checks} />
          </div>

          <div className={layout.second}>
            <Facts items={[starting.baseline]} />
          </div>
        </div>

        <div className={`${layout.phoneOnly} ${layout.last}`}>
          <PillLink to="/?scene=over">Stop for the night</PillLink>
        </div>
      </div>
    </Page>
  )
}
