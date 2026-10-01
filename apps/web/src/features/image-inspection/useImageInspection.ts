import { useEffect, useRef, useState } from 'react'
import { pixelIdentity, type ImagePixels } from './image-pixels'
import { useLoadedPixels } from './useLoadedPixels'
import { useNativeImage } from './useNativeImage'

export type { ImagePixels } from './image-pixels'

/** Retain the owner's complete snapshot with the exact decoded pixel resource. */
export function useImageInspection<T extends ImagePixels>(image: T | null, { scope }: { scope: string }) {
  const fitted = useLoadedPixels(image, scope)
  const [held, setHeld] = useState<{ image: T; url: string; scope: string } | null>(null)
  const [mode, setMode] = useState<'fit' | 'native'>('fit')
  const [nativeRequested, setNativeRequested] = useState(false)
  const pan = useRef<{ x: number; y: number } | null>(null)
  const currentHeld = held?.scope === scope ? held : null

  const heldFacts = useRef<T | null>(null)

  const heldImage = currentHeld && image && pixelIdentity(currentHeld.image) === pixelIdentity(image)
    ? image
    : currentHeld && heldFacts.current && pixelIdentity(heldFacts.current) === pixelIdentity(currentHeld.image)
      ? heldFacts.current
      : currentHeld?.image

  const frame = heldImage ?? fitted.loadedImage
  const fitUrl = currentHeld?.url ?? fitted.loadedUrl
  const native = useNativeImage(currentHeld?.image ?? null, nativeRequested)
  const nativeVisible = mode === 'native' && native.result?.state === 'ready'

  function hold() {
    if (!currentHeld && frame && fitUrl) setHeld({ image: frame, url: fitUrl, scope })
  }

  function showLatest() {
    setMode('fit')
    setNativeRequested(false)
    setHeld(null)
    pan.current = null
  }

  useEffect(showLatest, [scope])
  useEffect(() => { heldFacts.current = heldImage ?? null }, [heldImage])

  return {
    fitted, held: currentHeld, frame, fitUrl, mode, nativeRequested, native, nativeVisible, pan,
    hold, showLatest,
    showFit: () => setMode('fit'),
    showNative: () => { hold(); setMode('native'); setNativeRequested(true) },
  }
}

export type ImageInspection<T extends ImagePixels = ImagePixels> = ReturnType<typeof useImageInspection<T>>
