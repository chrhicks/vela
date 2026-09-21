import type { CapturePhase } from './capture.js'

export interface NavigationCapture {
  rigId: string
  rigName: string
  phase: CapturePhase
  captureReadState: 'current' | 'retrying'
  active: boolean
  completedCount: number
  elapsedSeconds: number
  exposureSeconds: number
  error: string | null
}

/** Catalog identities and known ephemeral runs, without device inspection. */
export interface NavigationView {
  rigs: { id: string, name: string }[]
  /** Includes terminal controllers; absence does not confirm a previous run ended. */
  captures: NavigationCapture[]
}
