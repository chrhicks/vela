import { encodeCaptureFits } from './fits.js'
import { capturePreviews } from './preview.js'
import { measureStars } from './statistics.js'

/**
 * What a controller does with a frame it has just read. The real work yields to
 * the event loop and waits on the zlib thread pool, which a test's fake clock
 * cannot advance, so tests that drive a controller through a frame pass their
 * own.
 */
export interface FrameImaging {
  readonly render: typeof capturePreviews
  readonly analyze: typeof measureStars
  readonly encodeFits: typeof encodeCaptureFits
}

// Each call looks the function up again, so a test that spies on one of the
// imaging modules still intercepts it.
export const frameImaging: FrameImaging = {
  render: (...args) => capturePreviews(...args),
  analyze: (...args) => measureStars(...args),
  encodeFits: (...args) => encodeCaptureFits(...args),
}
