import { backgroundOffsets, linkedRange, type PreviewFrame } from '../../server/src/imaging/background.js'
import { capturePreviews } from '../../server/src/imaging/preview.js'

export { backgroundOffsets, linkedRange, type PreviewFrame }

// B now exercises the adopted renderer; the comparison's A remains frozen at 59fa6da.
export async function neutralPreviews(frame: PreviewFrame) {
  const range = linkedRange(frame.pixels)
  const estimate = backgroundOffsets(frame, range)
  const { native, fit } = await capturePreviews(frame.width, frame.height, frame.pixels, frame.color)

  return { native, fit: fit ?? native, range, estimate }
}
