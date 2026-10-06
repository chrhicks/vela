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

export class CriaIdentityError extends EquipmentError {
  constructor(message: string, endpoint: string) {
    super(message, { reason: 'invalid-response', endpoint })
    this.name = 'CriaIdentityError'
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
    super(message, { reason: 'transport', endpoint, cause: options?.cause })
    this.name = 'CriaUncertainError'
  }
}

export class CriaOperationFailedError extends EquipmentError {
  constructor(readonly operation: CriaOperation, endpoint: string) {
    super(operation.message ?? 'Cria operation failed', { reason: 'protocol-error', endpoint })
    this.name = 'CriaOperationFailedError'
  }
}

export class CriaCancelledError extends EquipmentError {
  constructor(readonly operation: CriaOperation, endpoint: string) {
    super(operation.message ?? 'Equipment cancellation confirmed', { reason: 'protocol-error', endpoint })
    this.name = 'CriaCancelledError'
  }
}
