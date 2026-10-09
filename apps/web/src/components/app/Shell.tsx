import { Outlet, matchPath, useLocation } from 'react-router'
import { AppNavigation } from '../../features/navigation/AppNavigation'
import { RigObservationProvider } from '../../features/rig-detail/RigContext'
import { useAppearance } from '../../appearance/AppearanceProvider'

export default function Shell() {
  const { pathname } = useLocation()
  const rigId = matchPath('/rigs/:rigId/*', pathname)?.params.rigId
  // Polar alignment reads the same devices every few seconds; a full inspection would compete.
  const paused = !!matchPath('/rigs/:rigId/observe/alignment', pathname)
  const { mode } = useAppearance()
  const content = <><AppNavigation /><main><Outlet /></main></>

  return (
    <div className="vela-theme vela-app min-h-screen" data-mode={mode}>
      {rigId ? (
        <RigObservationProvider key={rigId} rigId={rigId} paused={paused}>
          {content}
        </RigObservationProvider>
      ) : (
        content
      )}
    </div>
  )
}
