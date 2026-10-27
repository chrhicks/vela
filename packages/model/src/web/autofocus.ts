/** Server-owned, ephemeral one-shot Star-HFR autofocus. Samples grow as shorts land. */
export interface AutofocusSample {
  position: number
  detectedStars: number
  hfrPixels: number | null
  capturedAt: string
}

/** One star measured in an autofocus sample: native pixel position, flux signal-to-noise, half-flux radius in pixels. */
export interface AutofocusStar {
  x: number
  y: number
  snr: number
  hfr: number
}

/** An autofocus sample and the stars behind it, brightest first and capped, so `stars` can be shorter than `detectedStars`. */
export interface AutofocusStarSample extends AutofocusSample {
  stars: AutofocusStar[]
}

/**
 * Everything a replay needs from one autofocus run: how it was set up, each sample with its star
 * table in the order measured, and the fit it chose. `version` changes only when a field's meaning does.
 */
export interface AutofocusRun {
  version: 1
  rigId: string
  startedAt: string
  /** Null while the run is still going. */
  settledAt: string | null
  phase: AutofocusPhase
  error: string | null
  startPosition: number | null
  stepSize: number
  offsetSteps: number
  exposureSeconds: number
  fit: AutofocusFit | null
  /**
   * Air temperature from the rig's observing-conditions device when the run began and when it
   * settled. Null when the rig has no such device or it could not be read in time. The end is null
   * in the live view until the run settles.
   */
  airTemperatureC: { start: number | null; end: number | null }
  samples: AutofocusStarSample[]
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

/** How the last run-ending move reached its target: through `via` (above it), then down onto `target`. */
export interface AutofocusApproach {
  purpose: 'best-focus' | 'restore-start'
  target: number
  /** Position passed through before coming down onto the target. Null when nothing fit above the target, so the move was direct. */
  via: number | null
}

export type AutofocusPhase =
  | 'setup'
  | 'walking'
  | 'fitting'
  | 'confirming'
  | 'complete'
  | 'stopped'
  | 'failed'

export type AutofocusActivity =
  | 'idle'
  | 'moving'
  | 'exposing'
  | 'measuring'
  | 'fitting'
  | 'restoring'
  | 'stopping'

export interface AutofocusView {
  rigId: string
  rigName: string
  enabled: boolean
  unavailableReason: string | null
  cameraName: string | null
  focuserName: string | null
  phase: AutofocusPhase
  activity: AutofocusActivity
  /** Interrupted reads of the same exposure; current does not imply image completion. */
  captureReadState: 'current' | 'retrying'
  active: boolean
  /** EAF position when the session began. Restore target. 0 is a reported mechanical stop, not a request to Move(0). */
  startPosition: number | null
  currentPosition: number | null
  /** Lowest reported focuser position. Absent from older servers and null when the focuser reports none; the floor is then 0. */
  minStep?: number | null
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
  /** The last run-ending move and its route. Absent from older servers; null until a run reaches one. */
  finalApproach?: AutofocusApproach | null
  error: string | null
}
