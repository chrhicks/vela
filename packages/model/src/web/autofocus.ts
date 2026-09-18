/** Server-owned, ephemeral one-shot Star-HFR autofocus. Samples grow as shorts land. */
export interface AutofocusSample {
  position: number
  detectedStars: number
  hfrPixels: number | null
  capturedAt: string
}

export interface AutofocusFit {
  /** Integer focuser step to command. */
  position: number
  /** Unrounded hyperbola vertex. */
  p: number
  a: number
  b: number
  rSquared: number
  minSamplePosition: number
}

export type AutofocusPhase = 'setup' | 'walking' | 'fitting' | 'confirming' | 'complete' | 'stopped' | 'failed'

export type AutofocusActivity = 'idle' | 'moving' | 'exposing' | 'measuring' | 'fitting' | 'restoring' | 'stopping'

export interface AutofocusView {
  rigId: string
  rigName: string
  enabled: boolean
  unavailableReason: string | null
  cameraName: string | null
  focuserName: string | null
  phase: AutofocusPhase
  activity: AutofocusActivity
  active: boolean
  /** EAF position when the session began. Restore target. 0 is a reported mechanical stop, not a request to Move(0). */
  startPosition: number | null
  currentPosition: number | null
  maxStep: number | null
  stepSize: number
  offsetSteps: number
  exposureSeconds: number
  elapsedSeconds: number
  exposureStartedAt: string | null
  samples: AutofocusSample[]
  fit: AutofocusFit | null
  /** True only after a failed or cancelled walk confirmed return to start. False if restore was not attempted or not confirmed. */
  restoredStart: boolean
  error: string | null
}
