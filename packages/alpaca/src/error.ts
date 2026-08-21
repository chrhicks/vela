export type AlpacaProviderErrorReason =
  | 'transport'
  | 'invalid-response'
  | 'protocol-error'

export interface AlpacaProviderErrorOptions {
  reason: AlpacaProviderErrorReason
  endpoint: string
  cause?: unknown
  errorNumber?: number
}

export class AlpacaProviderError extends Error {
  readonly reason: AlpacaProviderErrorReason
  readonly endpoint: string
  readonly errorNumber?: number

  constructor(message: string, options: AlpacaProviderErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'AlpacaProviderError'
    this.reason = options.reason
    this.endpoint = options.endpoint

    if (options.errorNumber !== undefined) {
      this.errorNumber = options.errorNumber
    }
  }
}
