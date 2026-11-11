import { useParams } from 'react-router'

import { ActionLink } from '../../components/ActionLink.tsx'
import { Page } from '../../components/Page.tsx'
import { PageHeader } from '../../components/PageHeader.tsx'
import { Inspector } from './Inspector.tsx'
import { frameFacts, latestFrame } from './stub.ts'

function frameAsked(number: string | undefined): number {
  const asked = Number.parseInt(number ?? '', 10)

  return Number.isInteger(asked) && asked >= 1 && asked <= latestFrame ? asked : latestFrame
}

export function FramePage() {
  const frame = frameAsked(useParams().number)

  return (
    <Page width="wide">
      <PageHeader title={`Frame ${frame}`} facts={frameFacts}>
        {frame > 1 ? <ActionLink to={`/frame/${frame - 1}`}>← {frame - 1}</ActionLink> : null}
        {frame < latestFrame ? <ActionLink to={`/frame/${frame + 1}`}>{frame + 1} →</ActionLink> : null}
        <ActionLink to="/stack">Stack</ActionLink>
        <ActionLink to="/?scene=capturing">Close</ActionLink>
      </PageHeader>

      <Inspector key={frame} seed={frame} glow="faint" />
    </Page>
  )
}
