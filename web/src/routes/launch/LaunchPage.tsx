import { Page } from '../../components/Page.tsx'
import { PageHeader } from '../../components/PageHeader.tsx'
import { PillLink } from '../../components/PillLink.tsx'
import { Readings } from '../../components/Readings.tsx'
import styles from './LaunchPage.module.css'
import { rigReady } from './stub.ts'

export function LaunchPage() {
  return (
    <Page width="phone">
      <PageHeader title="Rig ready" facts={[rigReady.at]} />

      <p className={styles.verdict}>Go inside</p>

      <Readings rows={rigReady.summary} />

      <footer className={styles.footer}>
        <span className={styles.step}>Step 6 of 6</span>

        <PillLink to="/">Pick target</PillLink>
      </footer>
    </Page>
  )
}
