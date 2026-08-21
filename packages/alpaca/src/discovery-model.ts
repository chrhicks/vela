import type { AlpacaDeviceKind } from './model.js'

export interface AlpacaEndpoint {
  readonly host: string
  readonly port: number
}

export interface AlpacaInspectionDevice {
  readonly providerDeviceId?: string
  readonly kind: AlpacaDeviceKind
  readonly name: string
}

export interface AlpacaInspection {
  readonly endpoint: AlpacaEndpoint
  readonly apiVersions: ReadonlyArray<number>
  readonly server: {
    readonly name?: string
    readonly manufacturer?: string
    readonly manufacturerVersion?: string
    readonly location?: string
  }
  readonly devices: ReadonlyArray<AlpacaInspectionDevice>
}

export interface AlpacaScanOptions {
  readonly signal?: AbortSignal
  readonly durationMs?: number
  readonly attempts?: number
  readonly interfaceAddresses?: ReadonlyArray<string>
}

export interface AlpacaInspectOptions {
  readonly signal?: AbortSignal
  readonly requestTimeoutMs?: number
}

export interface AlpacaUdpScanRequest {
  readonly signal?: AbortSignal
  readonly durationMs: number
  readonly attempts: number
  readonly interfaceAddresses?: ReadonlyArray<string>
}

/** Factory injection seam for deterministic tests. Normal callers use the default scanner. */
export interface AlpacaUdpScanner {
  scan(options: AlpacaUdpScanRequest): Promise<ReadonlyArray<AlpacaEndpoint>>
}

export interface AlpacaDiscoveryOptions {
  readonly fetch?: typeof globalThis.fetch
  readonly udpScanner?: AlpacaUdpScanner
}

export interface AlpacaDiscovery {
  scan(options?: AlpacaScanOptions): Promise<ReadonlyArray<AlpacaEndpoint>>
  inspect(
    endpoint: AlpacaEndpoint,
    options?: AlpacaInspectOptions,
  ): Promise<AlpacaInspection>
}
