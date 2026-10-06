import { EquipmentError, type EquipmentErrorOptions } from '@vela/equipment'

export type {
  EquipmentErrorReason as AlpacaProviderErrorReason,
  EquipmentErrorOptions as AlpacaProviderErrorOptions,
} from '@vela/equipment'

export class AlpacaDiscoveryError extends Error {
  readonly reason = 'transport' as const

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'AlpacaDiscoveryError'
  }
}

export class AlpacaProviderError extends EquipmentError {
  constructor(message: string, options: EquipmentErrorOptions) {
    super(message, options)
    this.name = 'AlpacaProviderError'
  }
}
