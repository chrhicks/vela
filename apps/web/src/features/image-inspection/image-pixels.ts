export interface ImagePixels {
  id: string
  imageUrl: string
  fitImageUrl?: string
  width: number
  height: number
}

// One acquisition may have multiple immutable renderer versions.
export function pixelIdentity(image: ImagePixels) {
  return JSON.stringify([image.id, image.imageUrl, image.fitImageUrl])
}
