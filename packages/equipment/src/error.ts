export type EquipmentErrorReason = 'transport' | 'invalid-response' | 'protocol-error'

export interface EquipmentErrorOptions {
  reason: EquipmentErrorReason
  endpoint: string
  cause?: unknown
  errorNumber?: number
}

export class EquipmentError extends Error {
  readonly reason: EquipmentErrorReason
  readonly endpoint: string
  readonly errorNumber?: number

  constructor(message: string, options: EquipmentErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'EquipmentError'
    this.reason = options.reason
    this.endpoint = options.endpoint

    if (options.errorNumber !== undefined) {
      this.errorNumber = options.errorNumber
    }
  }
}

export class CaptureStoppedError extends Error {
  constructor() {
    super('Exposure cancellation confirmed')
    this.name = 'AbortError'
  }
}

export class FocuserStoppedError extends Error {
  constructor() {
    super('Focuser move cancellation confirmed')
    this.name = 'AbortError'
  }
}

export class FramingStoppedError extends Error {
  constructor() {
    super('Telescope slew cancellation confirmed')
    this.name = 'AbortError'
  }
}

/**
 * The exposure finished but its frame was gone before it could be fetched. That frame is lost; a
 * later exposure is a new frame, never a repair of this one.
 */
export class FrameLostError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'FrameLostError'
  }
}

/** A new exposure is safe to attempt because no exposure started, or cleanup
 * confirmed the acknowledged exposure stopped and the camera is idle. */
export class CaptureRetryableError extends Error {
  constructor(cause: EquipmentError) {
    super(cause.message, { cause })
    this.name = 'CaptureRetryableError'
  }
}

/** The adapter cannot say whether a focuser move reached its target. Nothing should move the focuser again without a person's say. */
export class FocuserUncertainError extends EquipmentError {
  constructor(message: string, options: EquipmentErrorOptions) {
    super(message, options)
    this.name = 'FocuserUncertainError'
  }
}

/** The adapter cannot say whether the exposure ran. The camera needs a person's check before it is used again. */
export class CaptureUncertainError extends EquipmentError {
  constructor(message: string, options: EquipmentErrorOptions) {
    super(message, options)
    this.name = 'CaptureUncertainError'
  }
}
