/** Server-owned, ephemeral one-shot Star-HFR autofocus. Samples grow as shorts land. */
export interface AutofocusSample {
  position: number
  detectedStars: number
  hfrPixels: number | null
  capturedAt: string
  /** Which pass took it. Absent on a sample recorded before the two-pass walk. */
  pass?: AutofocusPass
}

/** The coarse pass finds the minimum's neighbourhood, the fine pass locates it, and a confirm frame checks the landing. */
export type AutofocusPass = 'coarse' | 'fine' | 'confirm'

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
  /** The coarse pass: the step and the number of steps on each side of the start. */
  stepSize: number
  offsetSteps: number
  /** The fine pass, centred on the coarse minimum. */
  fineStepSize: number
  fineOffsetSteps: number
  /** How much worse than the best fine-pass sample a confirm frame may be (0.1 is 10 %). */
  confirmTolerance: number
  /** The focuser positions the run could command, which bound every window extension. Null if it never read them. */
  travel: { min: number; max: number } | null
  exposureSeconds: number
  /** The fine-pass fit, or null when the fine pass had no usable fit and the run used its best measured sample. */
  fit: AutofocusFit | null
  /** The landing and its confirm frames. Null until the run reaches them, and for a run that stopped or failed first. */
  landing: AutofocusLanding | null
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

/**
 * Where the run left the focuser, and what the confirm frames said about it. The first attempt is
 * the fitted position, or the best fine-pass sample when there was no usable fit. If its confirm
 * frame is worse than that sample by more than `tolerance`, a second attempt lands on the sample.
 */
export interface AutofocusLanding {
  /** The last attempt's position: where the focuser is. */
  position: number
  /**
   * `confirmed`: the first attempt's confirm frame was within tolerance. `fell-back`: the first was not,
   * and the second, at the best sample, was. `unconfirmed`: the last attempt's frame was not.
   */
  outcome: 'confirmed' | 'fell-back' | 'unconfirmed'
  /** The lowest-HFR fine-pass sample the confirm frames are judged against. */
  bestSample: { position: number; hfrPixels: number }
  tolerance: number
  attempts: AutofocusLandingAttempt[]
}

export interface AutofocusLandingAttempt {
  source: 'fit' | 'best-sample'
  position: number
  /** Index in `samples` of the confirm frame taken here. */
  sampleIndex: number
  /** That frame's HFR, null if it measured no star. */
  hfrPixels: number | null
  withinTolerance: boolean
}

/** How the last run-ending move reached its target: through `via` (above it), then down onto `target`. */
export interface AutofocusApproach {
  purpose: 'best-focus' | 'best-sample' | 'restore-start'
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
  /** The coarse pass. Absent from older servers, which walked one pass. */
  stepSize: number
  offsetSteps: number
  /** The fine pass and the confirm tolerance. Absent from older servers. */
  fineStepSize?: number
  fineOffsetSteps?: number
  confirmTolerance?: number
  exposureSeconds: number
  elapsedSeconds: number
  exposureStartedAt: string | null
  samples: AutofocusSample[]
  fit: AutofocusFit | null
  /** Absent from older servers; null until the landing finishes. */
  landing?: AutofocusLanding | null
  /** True only after a failed or cancelled walk confirmed return to start. False if restore was not attempted or not confirmed. */
  restoredStart: boolean
  /** The last run-ending move and its route. Absent from older servers; null until a run reaches one. */
  finalApproach?: AutofocusApproach | null
  error: string | null
}
