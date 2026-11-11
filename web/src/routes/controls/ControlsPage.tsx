import { ActionLink } from '../../components/ActionLink.tsx'
import { Page } from '../../components/Page.tsx'
import { PageHeader } from '../../components/PageHeader.tsx'
import { Readings } from '../../components/Readings.tsx'
import styles from './ControlsPage.module.css'
import { areas } from './stub.ts'

export function ControlsPage() {
  return (
    <Page width="wide">
      <PageHeader title="Controls" facts={['No run']}>
        <ActionLink to="/">Back to run</ActionLink>
      </PageHeader>

      <div className={styles.areas}>
        {areas.map(area => (
          <Readings key={area.heading} heading={area.heading} rows={area.rows} />
        ))}
      </div>
    </Page>
  )
}
