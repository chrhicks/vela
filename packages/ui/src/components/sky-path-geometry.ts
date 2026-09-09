export type SkyCoordinate = { azimuthDegrees: number; altitudeDegrees: number }
export type HorizonPoint = { azimuthDegrees: number; altitudeDegrees: number | null }

export function projectSky(point: SkyCoordinate, center: number, radius: number) {
  const angle = point.azimuthDegrees * Math.PI / 180
  const distance = radius * (90 - point.altitudeDegrees) / 90
  return { x: center - Math.sin(angle) * distance, y: center - Math.cos(angle) * distance }
}

export function coordinatePath(points: readonly SkyCoordinate[], center: number, radius: number) {
  return points.map((point, index) => {
    const { x, y } = projectSky(point, center, radius)
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' ')
}

// Clip rising/setting segments at altitude zero; a below-horizon sample must
// never be folded into the visible dome or connected across an invisible span.
export function visibleSkyPath(points: readonly SkyCoordinate[], center: number, radius: number) {
  const segments: SkyCoordinate[][] = []
  for (let index = 1; index < points.length; index += 1) {
    let first = points[index - 1]!
    let last = points[index]!
    if (first.altitudeDegrees < 0 && last.altitudeDegrees < 0) continue
    if (first.altitudeDegrees < 0 || last.altitudeDegrees < 0) {
      const fraction = -first.altitudeDegrees / (last.altitudeDegrees - first.altitudeDegrees)
      const delta = ((last.azimuthDegrees - first.azimuthDegrees + 540) % 360) - 180
      const crossing = { azimuthDegrees: first.azimuthDegrees + delta * fraction, altitudeDegrees: 0 }
      if (first.altitudeDegrees < 0) first = crossing
      else last = crossing
    }
    segments.push([first, last])
  }
  return segments.map(segment => coordinatePath(segment, center, radius)).join(' ')
}

export function horizonAt(points: readonly HorizonPoint[], azimuthDegrees: number): number | null {
  if (points.length < 2) return null
  const sorted = points.map(point => ({ ...point, azimuthDegrees: ((point.azimuthDegrees % 360) + 360) % 360 }))
    .sort((a, b) => a.azimuthDegrees - b.azimuthDegrees)
  const azimuth = ((azimuthDegrees % 360) + 360) % 360
  for (let index = 0; index < sorted.length; index += 1) {
    const first = sorted[index]!
    const last = sorted[(index + 1) % sorted.length]!
    const end = index === sorted.length - 1 ? last.azimuthDegrees + 360 : last.azimuthDegrees
    const position = azimuth < first.azimuthDegrees ? azimuth + 360 : azimuth
    if (position < first.azimuthDegrees || position > end) continue
    if (first.altitudeDegrees === null || last.altitudeDegrees === null) return null
    const fraction = end === first.azimuthDegrees ? 0 : (position - first.azimuthDegrees) / (end - first.azimuthDegrees)
    return first.altitudeDegrees + fraction * (last.altitudeDegrees - first.altitudeDegrees)
  }
  return null
}

export function horizonSectors(points: readonly HorizonPoint[], margin: number, center: number, radius: number) {
  return Array.from({ length: 180 }, (_, index) => {
    const start = index * 2
    const end = start + 2
    const first = horizonAt(points, start)
    const last = horizonAt(points, end)
    const unknown = first === null || last === null
    const lower = [first ?? 12, last ?? 12].map(value => Math.max(0, Math.min(90, value)))
    const upper = lower.map(value => Math.min(90, value + margin))
    const polygon = (bottom: number[], top: number[]) => coordinatePath([
      { azimuthDegrees: start, altitudeDegrees: bottom[0]! },
      { azimuthDegrees: end, altitudeDegrees: bottom[1]! },
      { azimuthDegrees: end, altitudeDegrees: top[1]! },
      { azimuthDegrees: start, altitudeDegrees: top[0]! },
    ], center, radius) + ' Z'
    return { unknown, silhouette: polygon([0, 0], lower), band: polygon(lower, upper) }
  })
}

// Great-circle separation, independent of distortion in the overhead projection.
export function angularSeparationDegrees(first: SkyCoordinate, second: SkyCoordinate): number {
  const radians = Math.PI / 180
  const firstAltitude = first.altitudeDegrees * radians
  const secondAltitude = second.altitudeDegrees * radians
  const cosine = Math.sin(firstAltitude) * Math.sin(secondAltitude)
    + Math.cos(firstAltitude) * Math.cos(secondAltitude)
    * Math.cos((first.azimuthDegrees - second.azimuthDegrees) * radians)
  return Math.acos(Math.max(-1, Math.min(1, cosine))) / radians
}
