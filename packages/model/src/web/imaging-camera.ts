/** Remembered imaging identity and current choices; readiness here is selection identity, not exposure readiness. */
export interface ImagingCameraView {
  rigId: string
  selected: { id: string; name: string } | null
  /** Rig-detail identity when the saved camera matches the currently reported identity. */
  selectedDeviceId: string | null
  cameras: ReadonlyArray<{
    id: string
    name: string | null
    configuredName: string
  }>
  state: 'unselected' | 'ready' | 'missing' | 'changed' | 'unavailable'
  editable: boolean
}
