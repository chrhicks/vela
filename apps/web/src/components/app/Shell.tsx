import { Outlet, matchPath, useLocation } from 'react-router'
import { AlertBanner } from '../../features/alerts/AlertBanner'
import { AlertsProvider } from '../../features/alerts/AlertsProvider'
import { AppNavigation } from '../../features/navigation/AppNavigation'
import { useNavigation } from '../../features/navigation/use-navigation'
import { RigControls } from '../../features/rig-controls/RigControls'
import { RigObservationProvider } from '../../features/rig-detail/RigContext'
import { useAppearance } from '../../appearance/AppearanceProvider'

export default function Shell() {
  const { pathname } = useLocation()
  const rigId = matchPath('/rigs/:rigId/*', pathname)?.params.rigId
  // Polar alignment reads the same devices every few seconds; a full inspection would compete.
  const paused = !!matchPath('/rigs/:rigId/observe/alignment', pathname)
  const { mode } = useAppearance()
  const navigation = useNavigation()
  // Pages without a rig still show the alerts of the run being followed.
  const alertsRigId = rigId ?? navigation.activity?.rigId

  const content = (
    <>
      <AppNavigation navigation={navigation} />
      <AlertBanner />
      <main>
        <Outlet />
      </main>
    </>
  )

  return (
    <div className="vela-theme vela-app min-h-screen" data-mode={mode}>
      <AlertsProvider rigId={alertsRigId}>
        {rigId ? (
          <RigObservationProvider key={rigId} rigId={rigId} paused={paused}>
            <RigControls rigId={rigId}>{content}</RigControls>
          </RigObservationProvider>
        ) : (
          content
        )}
      </AlertsProvider>
    </div>
  )
}
