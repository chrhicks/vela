import { Link, useParams, useSearchParams } from 'react-router'

import { ActionLink } from '../../components/ActionLink.tsx'
import { Page } from '../../components/Page.tsx'
import { PageHeader } from '../../components/PageHeader.tsx'
import { CalibrationArea, CameraArea, DewArea, FocusArea, GuidingArea, MountArea, SystemArea } from './areas.tsx'
import styles from './ControlsPage.module.css'
import { ShutDown } from './ShutDown.tsx'
import { useRig } from '../../rig/store.ts'
import { AreaId, controlsAddress, runFacts } from './live.ts'
import { useAreas } from './use-areas.ts'

export function ControlsPage() {
  const { area } = useParams()
  const [search, setSearch] = useSearchParams()

  const { opened, asking } = controlsAddress(area, search.get('ask'))
  const setAsking = (ask: boolean) => setSearch(ask ? { ask: 'shut-down' } : {})

  const areas = useAreas()
  const run = useRig(rig => rig.run)

  return (
    <Page width="wide">
      <PageHeader title="Controls" facts={runFacts(run)}>
        <ShutDown asking={asking} onAsk={setAsking} />
      </PageHeader>

      <div className={styles.controls} data-opened={opened ?? 'none'}>
        <nav className={styles.summary} aria-label="Areas">
          {AreaId.literals.map(id => (
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
