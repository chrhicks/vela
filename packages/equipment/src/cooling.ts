/** Confirmed camera cooling facts. Sensor temperature is never a substitute for CoolerOn. */
export interface CameraCoolingObservation {
  readonly state: 'on' | 'off'
  readonly canSetTemperature: boolean
  readonly canGetPower: boolean
  readonly sensorTemperatureC?: number
  readonly setpointC?: number
  readonly powerPercent?: number
}

export type CameraCoolingCommandResult =
  | {
      readonly outcome: 'confirmed'
      readonly observation: CameraCoolingObservation
    }
  | {
      readonly outcome: 'failed'
      readonly reason:
        | 'device-not-found'
        | 'disconnected'
        | 'unsupported'
        | 'rejected'
        | 'not-confirmed'
      readonly message?: string
      readonly errorNumber?: number
    }
  | {
      readonly outcome: 'uncertain'
      readonly reason: 'cancelled' | 'write-outcome-unknown' | 'verification-unavailable'
    }

export interface CameraCoolingCommand {
  readonly cameraId: string
  readonly expectedCameraName?: string
  readonly coolerOn?: boolean
  readonly setpointC?: number
  readonly signal?: AbortSignal
}

export interface CameraCooling {
  observe(cameraId: string, signal?: AbortSignal): Promise<CameraCoolingObservation | undefined>
  setCooling(command: CameraCoolingCommand): Promise<CameraCoolingCommandResult>
}
