import { EquipmentError } from '@vela/equipment'
import type { CriaOperation, CriaOperationRequest } from './schema.js'

export class CriaApiError extends EquipmentError {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    endpoint: string,
  ) {
    super(message, { reason: 'protocol-error', endpoint })
    this.name = 'CriaApiError'
  }
}

const retryableStatuses = new Set([429, 500, 502, 503, 504])

/**
 * Whether retrying the same request may succeed: an interrupted transport or a retryable Cria
 * status. Anything else is an established rejection that retrying will not clear by itself.
 */
export function isTransientCriaFailure(error: EquipmentError): boolean {
  return error.reason === 'transport' || error instanceof CriaApiError && retryableStatuses.has(error.status)
}

export class CriaIdentityError extends EquipmentError {
  constructor(message: string, endpoint: string) {
    super(message, { reason: 'invalid-response', endpoint })
    this.name = 'CriaIdentityError'
  }
}

/**
 * A served original, or Cria's record of it, disagrees with what was requested or recorded: its
 * headers, length, digest or identities. Retrying is safe, but this is not a transport interruption.
 */
export class CriaOriginalVerificationError extends EquipmentError {
  constructor(message: string, endpoint: string) {
    super(message, { reason: 'invalid-response', endpoint })
    this.name = 'CriaOriginalVerificationError'
  }
}

/**
 * Cria no longer holds this image: it keeps only the newest completed captures. The frame is lost;
 * never expose again to repair it.
 */
export class CriaImageGoneError extends EquipmentError {
  constructor(message: string, endpoint: string) {
    super(message, { reason: 'protocol-error', endpoint })
    this.name = 'CriaImageGoneError'
  }
}

export class CriaUncertainError extends EquipmentError {
  constructor(
    message: string,
    endpoint: string,
    readonly request: CriaOperationRequest | null,
    readonly operation: CriaOperation | null,
    options?: ErrorOptions,
  ) {
    super(message, { reason: 'protocol-error', endpoint, cause: options?.cause })
    this.name = 'CriaUncertainError'
  }
}

export class CriaOperationFailedError extends EquipmentError {
  constructor(readonly operation: CriaOperation, endpoint: string) {
    super(operation.message ?? 'Cria operation failed', { reason: 'protocol-error', endpoint })
    this.name = 'CriaOperationFailedError'
  }
}

/** The initial observation failed before any command admission was attempted. */
export class CriaNotAdmittedError extends EquipmentError {
  constructor(cause: EquipmentError) {
    super(cause.message, { reason: cause.reason, endpoint: cause.endpoint, cause })
    this.name = 'CriaNotAdmittedError'
  }
}

export class CriaCancelledError extends EquipmentError {
  /** null establishes that cancellation happened before any admission request. */
  constructor(readonly operation: CriaOperation | null, endpoint: string) {
    super(operation?.message ?? 'Equipment cancellation confirmed', { reason: 'protocol-error', endpoint })
    this.name = 'CriaCancelledError'
  }
}
