declare module 'aladin-lite' {
  interface Viewer {
    world2pix(ra: number, dec: number): [number, number] | undefined
    pix2world(x: number, y: number): [number, number] | undefined
    gotoRaDec(ra: number, dec: number): void
    getFov(): [number, number]
    setFoV(fov: number): void
    on(event: string, callback: () => void): void
    remove(): void
  }

  // HiPS instances are opaque to Vela; only Aladin consumes them.
  class ImageSurvey {
    private readonly imageSurvey: never
  }

  interface SurveyOptions {
    name: string
    cooFrame: string
    maxOrder: number
    imgFormat: string
    requestMode: string
    errorCallback: () => void
  }

  interface ViewerOptions {
    survey: ImageSurvey
    log: boolean
    hipsList: string[]
    target: string
    fov: number
    projection: string
    cooFrame: string
    showLayersControl: boolean
    showFullscreenControl: boolean
    showZoomControl: boolean
    showGotoControl: boolean
    showShareControl: boolean
    showSettingsControl: boolean
    showSimbadPointerControl: boolean
    showStatusBar: boolean
    showFov: boolean
    showCooLocation: boolean
    showFrame: boolean
    showReticle: boolean
    showCooGridControl: boolean
    showProjectionControl: boolean
  }

  const A: {
    init: Promise<void>
    aladin(element: HTMLElement, options: ViewerOptions): Viewer
    imageHiPS(url: string, options: SurveyOptions): ImageSurvey
  }

  export default A
}
