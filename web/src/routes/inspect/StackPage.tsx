import { ActionLink } from '../../components/ActionLink.tsx'
import { Page } from '../../components/Page.tsx'
import { PageHeader } from '../../components/PageHeader.tsx'
import { Inspector } from './Inspector.tsx'
import { latestFrame, stackFacts } from './stub.ts'

export function StackPage() {
  return (
    <Page width="wide">
      <PageHeader title="Stack" facts={stackFacts}>
        <ActionLink to={`/frame/${latestFrame}`}>Frame {latestFrame}</ActionLink>
        <ActionLink to="/">Close</ActionLink>
      </PageHeader>

      <Inspector seed={7} glow="bright" />
    </Page>
  )
}
