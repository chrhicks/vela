import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { useAlerts } from './use-alerts'
import type { AlertsState } from './use-alerts'

const AlertsContext = createContext<AlertsState | undefined>(undefined)

/** The Shell keys this by rig, so one poll feeds the banner and the rig page card. */
export function AlertsProvider({ rigId, children }: { rigId: string; children: ReactNode }) {
  return <AlertsContext value={useAlerts(rigId)}>{children}</AlertsContext>
}

export function useRigAlerts() {
  return useContext(AlertsContext)
}
