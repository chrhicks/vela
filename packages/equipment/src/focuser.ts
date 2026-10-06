export interface FocuserTravelWindow {
  minPosition: number
  maxPosition: number
}

export interface FocuserStatus {
  absolute: boolean
  position: number
  maxStep: number
  moving: boolean
}

export interface FocuserMove {
  focuserId: string
  position: number
  window: FocuserTravelWindow
  signal?: AbortSignal
}

export interface Focuser {
  status(focuserId: string, signal?: AbortSignal): Promise<FocuserStatus>
  move(command: FocuserMove): Promise<{ position: number }>
  halt(focuserId: string): Promise<void>
}
