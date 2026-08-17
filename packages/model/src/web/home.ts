import type { DeviceSummary } from "../device/index.js"

export interface HomeView {
  rigs: Array<{
    id: string
    name: string
    reachable: boolean
    devices: DeviceSummary[]
  }>
  refreshedAt: string 
}