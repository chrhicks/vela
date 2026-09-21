export type BayerPattern = 'rggb' | 'grbg' | 'gbrg' | 'bggr'

/** Bilinear interpolation uses only in-frame neighbors, including at corners. */
export function bayerPixel(
  width: number,
  height: number,
  pixels: ArrayLike<number>,
  pattern: BayerPattern,
  x: number,
  y: number,
): number[] {
  // Interior pixels always have a complete neighborhood. Direct sums avoid
  // allocating per-pixel channel maps and repeatedly classifying nine neighbors.
  if (x > 0 && y > 0 && x < width - 1 && y < height - 1) {
    const i = y * width + x
    const center = pixels[i]!
    const own = pattern[(y % 2) * 2 + (x % 2)]

    if (own === 'g') {
      const horizontal = (pixels[i - 1]! + pixels[i + 1]!) / 2
      const vertical = (pixels[i - width]! + pixels[i + width]!) / 2

      return pattern[(y % 2) * 2 + ((x + 1) % 2)] === 'r'
        ? [horizontal, center, vertical]
        : [vertical, center, horizontal]
    }

    const green = (pixels[i - width]! + pixels[i - 1]! + pixels[i + 1]! + pixels[i + width]!) / 4

    const opposite =
      (pixels[i - width - 1]! +
        pixels[i - width + 1]! +
        pixels[i + width - 1]! +
        pixels[i + width + 1]!) /
      4

    return own === 'r' ? [center, green, opposite] : [opposite, green, center]
  }

  // Border pixels average only the neighbors that exist.
  const values = [0, 0, 0]
  const counts = [0, 0, 0]
  const channelAt = (px: number, py: number) => 'rgb'.indexOf(pattern[(py % 2) * 2 + (px % 2)]!)
  const ownChannel = channelAt(x, y)
  values[ownChannel] = pixels[y * width + x]!
  counts[ownChannel] = 1

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const px = x + dx
      const py = y + dy

      if (px < 0 || py < 0 || px >= width || py >= height) continue
      const channel = channelAt(px, py)

      if (channel === ownChannel) continue
      values[channel]! += pixels[py * width + px]!
      counts[channel]!++
    }
  }

  return values.map((value, channel) =>
    counts[channel] ? value / counts[channel]! : pixels[y * width + x]!,
  )
}
