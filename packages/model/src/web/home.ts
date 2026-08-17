import type { DeviceSummary } from "../device/index.js"

export interface RigView {
  id: string
  name: string
  reachable: boolean
  devices: DeviceSummary[]
}

export interface HomeView {
  rigs: RigView[]
  refreshedAt: string 
}