export {
  EquipmentError,
  CaptureStoppedError,
  CaptureRetryableError,
  FocuserStoppedError,
  FramingStoppedError,
} from './error.js'

export type { EquipmentErrorReason, EquipmentErrorOptions } from './error.js'

export type { Acquisition, CaptureOptions, Frame, FrameColor, Pointing } from './acquisition.js'

export type {
  Framing,
  CameraGeometry,
  TelescopeStatus,
  SlewOptions,
  CoordinateSystem,
} from './framing.js'

export type { Focuser, FocuserMove, FocuserStatus, FocuserTravelWindow } from './focuser.js'

export type {
  CameraCooling,
  CameraCoolingCommand,
  CameraCoolingCommandResult,
  CameraCoolingObservation,
} from './cooling.js'

export type {
  EquipmentDevice,
  DeviceKind,
  ConnectionStatus,
  DeviceConnectionResult,
  EquipmentInspection,
  EquipmentObservation,
  DeviceTelemetry,
  TelemetryAvailability,
  CameraActivity,
  SwitchChannel,
} from './inspection.js'

export type {
  EquipmentInventory,
  EquipmentInspector,
  EquipmentConnector,
  EquipmentProvider,
  InspectDevicesOptions,
  ConnectDeviceOptions,
} from './provider.js'
