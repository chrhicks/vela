import { useEffect, useRef } from 'react'

import type { Survey } from '../../../../../state/survey.ts'
import styles from './FramedSky.module.css'
import { skyPictureOf } from './sky-picture.ts'

interface FramedSkyProps {
  readonly survey: Survey | null
  readonly raDegrees: number
  readonly decDegrees: number
  readonly angleDegrees: number | undefined
  readonly offset: { readonly eastDegrees: number; readonly northDegrees: number } | undefined
}

const picture = { widthDegrees: 7, widthPixels: 768, heightPixels: 512 }
const pictureHeightDegrees = (picture.widthDegrees * picture.heightPixels) / picture.widthPixels
const frameDegrees = { width: 3.37, height: 2.25 }

const frameStyle = (angleDegrees: number, eastDegrees: number, northDegrees: number) => ({
  width: `${(frameDegrees.width / picture.widthDegrees) * 100}%`,
  height: `${(frameDegrees.height / pictureHeightDegrees) * 100}%`,
  left: `${50 - (eastDegrees / picture.widthDegrees) * 100}%`,
  top: `${50 - (northDegrees / pictureHeightDegrees) * 100}%`,
  transform: `translate(-50%, -50%) rotate(${angleDegrees}deg)`,
})

export function FramedSky({ survey, raDegrees, decDegrees, angleDegrees, offset }: FramedSkyProps) {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (survey === null) return

    let current = true

    void skyPictureOf({ raDegrees, decDegrees, ...picture, order: survey.order, tileWidth: survey.tileWidth }).then(cut => {
      if (current) canvas.current?.getContext('2d')?.putImageData(cut, 0, 0)
    })

    return () => {
      current = false
    }
  }, [survey, raDegrees, decDegrees])

  return (
    <div className={styles.sky}>
      <canvas ref={canvas} className={styles.picture} width={picture.widthPixels} height={picture.heightPixels} role="img" aria-label="The sky around the target, north up and east to the left" />

      <span className={styles.frame} style={frameStyle(angleDegrees ?? 0, offset?.eastDegrees ?? 0, offset?.northDegrees ?? 0)} />
    </div>
  )
}
