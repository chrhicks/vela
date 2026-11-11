import { ActionLink } from '../../components/ActionLink.tsx'
import { Page } from '../../components/Page.tsx'
import { PageHeader } from '../../components/PageHeader.tsx'
import { PillLink } from '../../components/PillLink.tsx'

export function RunPage() {
  return (
    <Page width="wide">
      <PageHeader title="No run" facts={['Rig not set up']}>
        <ActionLink to="/controls">Controls</ActionLink>
        <PillLink to="/launch">Launch</PillLink>
      </PageHeader>
    </Page>
  )
}
