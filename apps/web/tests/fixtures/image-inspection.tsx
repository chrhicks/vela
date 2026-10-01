import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useImageInspection } from '../../src/features/image-inspection/useImageInspection'
import { ImageViewport } from '../../src/features/image-inspection/ImageViewport'

const first = {
  id: 'same-acquisition', imageUrl: '/pixels/legacy/native', fitImageUrl: '/pixels/legacy/fit',
  width: 1600, height: 1200, label: 'Original preview',
}

const second = {
  ...first, imageUrl: '/pixels/current/native', fitImageUrl: '/pixels/current/fit', label: 'Current preview',
}

function Fixture() {
  const [image, setImage] = useState(first)
  const inspection = useImageInspection(image, { scope: 'saved:rig-1' })

  return <>
    <button onClick={() => setImage(second)}>Change version</button>
    <button onClick={inspection.showNative}>Native</button>
    <button onClick={inspection.showLatest}>Release hold</button>
    <span>{inspection.frame?.label}</span>
    <span>{inspection.native.result?.state}</span>
    <ImageViewport inspection={inspection} alt={inspection.frame?.label ?? ''} />
  </>
}

createRoot(document.getElementById('root')!).render(<Fixture />)
