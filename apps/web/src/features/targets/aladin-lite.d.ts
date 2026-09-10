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

  const A: {
    init: Promise<void>
    aladin(element: HTMLElement, options: Record<string, unknown>): Viewer
    imageHiPS(url: string, options: Record<string, unknown>): unknown
  }

  export default A
}
