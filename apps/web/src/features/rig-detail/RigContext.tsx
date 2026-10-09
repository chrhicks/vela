import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'
import { useRigDetail } from './use-rig-detail'
import type { RigDetailResult } from './use-rig-detail'

export type RigObservation = RigDetailResult & { rigId: string }

const RigContext = createContext<RigObservation | undefined>(undefined)

export function RigObservationProvider({
  rigId,
  paused,
  children,
}: {
  rigId: string
  paused: boolean
  children: ReactNode
}) {
  const observation = useRigDetail(rigId, { paused })

  return <RigContext value={{ ...observation, rigId }}>{children}</RigContext>
}

export function useRigObservation() {
  return useContext(RigContext)
}
