import { ActionLink } from '../../components/ActionLink.tsx'
import { Caption } from '../../components/Caption.tsx'
import { Log } from '../../components/Log.tsx'
import { Page } from '../../components/Page.tsx'
import { PageHeader } from '../../components/PageHeader.tsx'
import { Picture } from '../../components/Picture.tsx'
import { PillLink } from '../../components/PillLink.tsx'
import { Readings } from '../../components/Readings.tsx'
import { StatusLine } from '../../components/StatusLine.tsx'
import { StubSky } from '../../stub/StubSky.tsx'
import layout from './layout.module.css'
import { nightOver } from './stub.ts'
import { Trends } from './Trends.tsx'

export function NightOverView() {
  return (
    <Page width="wide">
      <PageHeader title="Ready to carry in" facts={nightOver.facts}>
        <ActionLink to="/controls">Controls</ActionLink>
      </PageHeader>

      <div className={layout.night}>
        <div className={`${layout.across} ${layout.first}`}>
          <StatusLine items={nightOver.rig} />
        </div>

        <div className={layout.column}>
          <div className={layout.second}>
            <Caption>The night</Caption>
          </div>

          <div className={layout.second}>
            <Readings rows={nightOver.totals} />
          </div>

          <div className={layout.fourth}>
            <Log heading="Handled without you" lines={nightOver.handled} />
          </div>
        </div>

        <div className={layout.column}>
          <div className={layout.third}>
            <Picture label="Final quick stack" detail={nightOver.stackDetail} to="/stack">
              <StubSky seed={7} glow="bright" />
            </Picture>
          </div>
        </div>

        <div className={`${layout.column} ${layout.wideOnly}`}>
          <Trends trends={nightOver.trends} span={nightOver.span} />
        </div>
      </div>
    </Page>
  )
}
