import { useEffect, useRef } from 'react'

export type CaptureRunConditions = 'changing' | 'clear' | 'haze' | 'soft' | 'streak'

type CaptureRunExposureProps = {
  frame: number
  conditions: CaptureRunConditions
  className?: string
}

const width = 1600

const height = 1200

function randomSequence(seed: number) {
  let state = seed >>> 0

  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0

    return state / 4294967296
  }
}

// Original procedural fixture, not catalog data or an astrophysical simulation.
// Keep the same field between exposures so small changes are inspectable at 100%.
const field = (() => {
  const random = randomSequence(93417)

  return Array.from({ length: 1800 }, () => ({
    x: random() * width,
    y: random() * height,
    brightness: 18 + Math.pow(random(), 5) * 650,
    size: 0.65 + random() * 0.6,
    warmth: random(),
    phase: random() * Math.PI * 2,
  }))
})()

function frameCondition(frame: number, conditions: CaptureRunConditions) {
  if (conditions !== 'changing') return conditions
  const phase = ((frame % 12) + 12) % 12

  if (phase === 7) return 'streak'

  if (phase === 3 || phase === 4) return 'haze'

  if (phase === 9 || phase === 10) return 'soft'

  return 'clear'
}

function drawExposure(context: CanvasRenderingContext2D, frame: number, conditions: CaptureRunConditions) {
  const condition = frameCondition(frame, conditions)
  const random = randomSequence(491 + frame * 8191)
  const image = context.createImageData(width, height)
  const pixels = image.data
  const cloudCenter = width * (0.35 + 0.18 * Math.sin(frame * 0.6))

  const hazeAt = (x: number, y: number) => condition === 'haze'
    ? Math.exp(-Math.pow((x + y * 0.4 - cloudCenter) / 600, 2)) * 0.32
    : 0

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      const noise = (random() - 0.5) * 5
      const vignette = 1 - 0.2 * Math.hypot((x - width / 2) / width, (y - height / 2) / height)
      const background = (13 + noise + hazeAt(x, y) * 17) * vignette
      pixels[index] = background * 0.86
      pixels[index + 1] = background * 0.94
      pixels[index + 2] = background
      pixels[index + 3] = 255
    }
  }

  for (const star of field) {
    const variation = Math.sin(frame * 0.91 + star.phase)
    const x = star.x + variation * 0.32
    const y = star.y + Math.cos(frame * 0.73 + star.phase) * 0.32
    const softness = condition === 'soft' ? 1.55 : 1
    const sigma = star.size * softness * (1 + variation * 0.08)
    const brightness = star.brightness * (1 + variation * 0.04) * (1 - hazeAt(x, y)) / (softness * softness)
    const radius = Math.ceil(sigma * 5)
    const color = star.warmth > 0.55 ? [1, 0.86, 0.68] : [0.72, 0.84, 1]

    for (let py = Math.max(0, Math.floor(y) - radius); py <= Math.min(height - 1, Math.ceil(y) + radius); py += 1) {
      for (let px = Math.max(0, Math.floor(x) - radius); px <= Math.min(width - 1, Math.ceil(x) + radius); px += 1) {
        const distance = (px - x) ** 2 + (py - y) ** 2
        const light = brightness * (Math.exp(-distance / (2 * sigma ** 2)) + 0.025 * Math.exp(-distance / (8 * sigma ** 2)))
        const index = (py * width + px) * 4
        pixels[index] = pixels[index]! + light * color[0]!
        pixels[index + 1] = pixels[index + 1]! + light * color[1]!
        pixels[index + 2] = pixels[index + 2]! + light * color[2]!
      }
    }
  }

  context.putImageData(image, 0, 0)

  if (condition === 'streak') {
    const trail = context.createLinearGradient(240, 870, 1270, 320)
    trail.addColorStop(0, 'rgba(204, 216, 228, 0)')
    trail.addColorStop(0.12, 'rgba(204, 216, 228, 0.52)')
    trail.addColorStop(0.88, 'rgba(204, 216, 228, 0.52)')
    trail.addColorStop(1, 'rgba(204, 216, 228, 0)')
    context.strokeStyle = trail
    context.lineWidth = 1.25
    context.beginPath()
    context.moveTo(240, 870)
    context.lineTo(1270, 320)
    context.stroke()
  }
}

const conditionDescriptions = {
  clear: 'a clear star field',
  haze: 'thin haze across part of the star field',
  soft: 'slightly softened stars',
  streak: 'a thin diagonal satellite-like streak',
} as const

export function CaptureRunExposure({ frame, conditions, className }: CaptureRunExposureProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const context = canvas.current?.getContext('2d')

    if (context) drawExposure(context, frame, conditions)
  }, [frame, conditions])

  return (
    <canvas
      ref={canvas}
      className={className}
      width={width}
      height={height}
      role="img"
      aria-label={`Illustrative exposure ${frame}: ${conditionDescriptions[frameCondition(frame, conditions)]}. Synthetic workshop fixture.`}
    />
  )
}
