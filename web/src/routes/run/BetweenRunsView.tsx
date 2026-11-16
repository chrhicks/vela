import { previewAddress } from '../../../../state/frames.ts'
import { ActionLink } from '../../components/ActionLink.tsx'
import { Caption } from '../../components/Caption.tsx'
import { CommandPill } from '../../components/CommandPill.tsx'
import { Page } from '../../components/Page.tsx'
import { PageHeader } from '../../components/PageHeader.tsx'
import { Picture } from '../../components/Picture.tsx'
import { PillLink } from '../../components/PillLink.tsx'
import { Readings } from '../../components/Readings.tsx'
import { StatusLine } from '../../components/StatusLine.tsx'
import { clockSeconds } from '../../rig/clock.ts'
import { useLink, useRig } from '../../rig/store.ts'
import { unknown } from '../../rig/words.ts'
import { lastRunFacts, rigNow, tonight, tonightsFrames } from './between.ts'
import layout from './layout.module.css'
import { trendWindows } from './live.ts'
import { Trends } from './Trends.tsx'

export function BetweenRunsView() {
  const run = useRig(rig => rig.run)
  const frames = useRig(rig => rig.frames)
  const devices = useRig(rig => rig.devices)
  const guiding = useRig(rig => rig.guiding)
  const trends = useRig(rig => rig.trends)
  const checked = useRig(rig => rig.firstFrames)
  const link = useLink()
  const now = link.beat?.at
  const night = tonightsFrames(frames, link.night)
  const latest = night.at(-1)
  const shown = now === undefined ? undefined : trendWindows(trends, now).run

  return (
    <Page width="wide">
      <PageHeader title="Between runs" facts={lastRunFacts(run)}>
        {night.length === 0 ? <ActionLink to="/launch">Launch</ActionLink> : null}
        <ActionLink to="/controls">Controls</ActionLink>
        <CommandPill request={{ command: 'stopForTheNight' }}>Stop for the night</CommandPill>
        <PillLink to="/?pick">Pick target</PillLink>
      </PageHeader>

      <div className={layout.night}>
        <div className={`${layout.across} ${layout.first}`}>
          <StatusLine items={rigNow(devices, guiding)} />
        </div>

        <div className={layout.column}>
          <div className={layout.second}>
            <Caption>Tonight</Caption>
          </div>

          <div className={layout.second}>
            <Readings rows={tonight(night, checked, run)} />
          </div>
        </div>

        <div className={layout.column}>
          <div className={layout.third}>
            <Picture label="Latest frame" detail={latest === undefined ? unknown : `${night.length} · ${clockSeconds(latest.keptAt)}`} {...(latest === undefined ? {} : { to: `/frame/${night.length}` })}>
              {latest === undefined ? null : <img src={previewAddress(latest)} alt={`Frame ${night.length}`} className={layout.frameImage} />}
            </Picture>
          </div>
        </div>

        <div className={layout.column}>
          {shown === undefined ? null : (
            <div className={layout.fourth}>
              <Trends {...shown} />
            </div>
          )}
        </div>
      </div>
    </Page>
  )
}
