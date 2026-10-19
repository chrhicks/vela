import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { useAlerts } from './use-alerts'
import type { AlertsState } from './use-alerts'

const AlertsContext = createContext<AlertsState | undefined>(undefined)

/**
 * The Shell mounts this once, above everything that changes with the route, so each rig's last view
 * survives navigation. It feeds the banner and the rig page card from one poll. `rigId` is the
 * route's rig, or on pages without one the rig whose run the navigation follows.
 */
export function AlertsProvider({ rigId, children }: { rigId: string | undefined; children: ReactNode }) {
  const alerts = useAlerts(rigId)

  return <AlertsContext value={rigId ? alerts : undefined}>{children}</AlertsContext>
}

export function useRigAlerts() {
  return useContext(AlertsContext)
}
