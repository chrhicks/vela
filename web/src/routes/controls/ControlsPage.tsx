import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'

import { ActionLink } from '../../components/ActionLink.tsx'
import { Page } from '../../components/Page.tsx'
import { PageHeader } from '../../components/PageHeader.tsx'
import { CalibrationArea, CameraArea, DewArea, FocusArea, GuidingArea, MountArea, SystemArea } from './areas.tsx'
import styles from './ControlsPage.module.css'
import { ShutDown } from './ShutDown.tsx'
import { areaIds, areas, run } from './stub.ts'

export function ControlsPage() {
  const { area } = useParams()
  const [search] = useSearchParams()
  const [asking, setAsking] = useState(search.get('ask') === 'shut-down')

  const opened = areaIds.find(id => id === area)

  return (
    <Page width="wide">
      <PageHeader title="Controls" facts={run}>
        <ShutDown asking={asking} onAsk={setAsking} />
      </PageHeader>

      <div className={styles.controls} data-opened={opened ?? 'none'}>
        <nav className={styles.summary} aria-label="Areas">
          {areaIds.map(id => (
            <Link key={id} to={`/controls/${id}`} className={styles.entry}>
              <span className={styles.heading}>{areas[id].heading}</span>
              <span className={styles.state}>{areas[id].summary}</span>
            </Link>
          ))}
        </nav>

        <div className={styles.areas}>
          <MountArea />
          <GuidingArea />
          <FocusArea />
          <CameraArea />
          <DewArea />
          <CalibrationArea />
          <SystemArea />
        </div>

        <div className={styles.back}>
          <ActionLink to="/controls">Controls</ActionLink>
        </div>
      </div>
    </Page>
  )
}
