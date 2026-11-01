export type FrameColor = { readonly kind: 'mono' } | { readonly kind: 'bayer'; readonly pattern: 'rggb' | 'grbg' | 'gbrg' | 'bggr' }

export interface MonoFrame {
  readonly width: number
  readonly height: number
  readonly pixels: ArrayLike<number>
  readonly capturedAt: string
  readonly capturedAtSource: 'camera' | 'server-estimate'
  readonly exposureSeconds: number
  readonly color: FrameColor
}
