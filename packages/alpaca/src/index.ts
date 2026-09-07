export { AlpacaDiscoveryError, AlpacaProviderError } from './error.js'
export type { AlpacaProviderErrorReason } from './error.js'
export { createAlpacaDiscovery } from './discovery.js'
export type {
  AlpacaDiscovery,
  AlpacaDiscoveryOptions,
  AlpacaEndpoint,
  AlpacaInspectOptions,
  AlpacaInspection,
  AlpacaInspectionDevice,
  AlpacaScanOptions,
  AlpacaUdpScanner,
} from './discovery-model.js'
export { createAlpacaProvider } from './provider.js'
export type {
  AlpacaConnectDeviceOptions,
  AlpacaInspectDevicesOptions,
  AlpacaProvider,
  AlpacaProviderOptions,
} from './provider.js'
export type {
  AlpacaCameraActivity,
  AlpacaConnectionStatus,
  AlpacaDevice,
  AlpacaDeviceConnectionResult,
  AlpacaDeviceInspection,
  AlpacaDeviceKind,
  AlpacaDeviceTelemetry,
  AlpacaSwitchChannel,
  AlpacaTelemetryAvailability,
} from './model.js'
export { createAlpacaAcquisition, AlpacaCaptureStoppedError } from './acquisition.js'
export type { AlpacaAcquisition, AlpacaAcquisitionOptions, AlpacaCaptureOptions, AlpacaFrame, AlpacaFrameColor, AlpacaPointing } from './acquisition.js'
export { createAlpacaFraming, AlpacaFramingStoppedError } from './framing.js'
export type { AlpacaFraming, AlpacaFramingOptions, AlpacaCameraGeometry, AlpacaTelescopeStatus, AlpacaSlewOptions, AlpacaCoordinateSystem } from './framing.js'
