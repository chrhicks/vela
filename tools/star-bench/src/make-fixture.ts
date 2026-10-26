import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodeCaptureFits } from '@vela/server/imaging/fits'
import { measureStars } from '@vela/server/imaging/statistics'

/**
 * Writes the committed fixture: four made-up frames in the layout of Vela's saved-images store,
 * recorded with the code as it is now. A later change to the measurement makes the bench report
 * these frames as differing until this runs again, and the diff of `fixture/` shows by how much.
 * The date, camera and target are invented. Nothing here comes from a real night.
 */
const width = 192

const height = 144

const exposureSeconds = 90

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixture', 'saved-images', 'fixture-rig')

interface FixtureStar {
  x: number
  y: number
  amplitude: number
  sigma: number
}

const field = starField()

const frames = [
  { id: 'fixture-light-1', frameType: 'light', minutes: 0, stars: field },
  { id: 'fixture-light-2', frameType: 'light', minutes: 3, stars: field },
  { id: 'fixture-light-3-haze', frameType: 'light', minutes: 6, stars: field.slice(0, 6) },
  { id: 'fixture-dark', frameType: 'dark', minutes: 9, stars: [] },
] as const

await rm(root, { recursive: true, force: true })

const random = seededRandom(7)

for (const frame of frames) {
  const capturedAt = new Date(Date.UTC(2030, 0, 1, 2, frame.minutes)).toISOString()
  const pixels = render(frame.stars, random)
  const color = { kind: 'bayer', pattern: 'rggb' } as const
  const statistics = await measureStars(width, height, pixels, color)
  const directory = join(root, frame.id)
  await mkdir(directory, { recursive: true })

  await writeFile(
    join(directory, 'original.fits'),
    await encodeCaptureFits(
      { width, height, pixels, capturedAt, color },
      { exposureSeconds, cameraName: 'Fixture Camera', frameType: frame.frameType },
    ),
  )

  await writeFile(
    join(directory, 'metadata.json'),
    JSON.stringify(
      {
        id: frame.id,
        rigId: 'fixture-rig',
        saved: true,
        frameType: frame.frameType,
        subject: frame.frameType === 'light'
          ? { targetId: 'fixture-nebula', name: 'Fixture Nebula', catalog: 'FX 1' }
          : null,
        capturedAt,
        receivedAt: capturedAt,
        savedAt: capturedAt,
        width,
        height,
        cameraName: 'Fixture Camera',
        exposureSeconds,
        color: 'color',
        statistics,
      },
      null,
      2,
    ) + '\n',
  )

  console.log(frame.id, statistics)
}

/** A jittered grid, clear of the edges and wider than the measurement's isolation distance. */
function starField() {
  const random = seededRandom(11)
  const stars: FixtureStar[] = []

  for (let row = 0; row < 5; row++) {
    for (let column = 0; column < 7; column++) {
      stars.push({
        x: 24 + column * 24 + random() * 8,
        y: 22 + row * 25 + random() * 8,
        amplitude: 6000 - (row * 7 + column) * 150 + random() * 400,
        sigma: 1.9 + random() * 0.6,
      })
    }
  }

  return stars
}

function render(stars: readonly FixtureStar[], random: () => number) {
  const pixels = new Int32Array(width * height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = 1000 + 12 * gaussian(random)

      for (const star of stars) {
        const distance = (x - star.x) ** 2 + (y - star.y) ** 2

        if (distance < (6 * star.sigma) ** 2) value += star.amplitude * Math.exp(-distance / (2 * star.sigma ** 2))
      }

      pixels[y * width + x] = Math.max(0, Math.min(65535, Math.round(value)))
    }
  }

  return pixels
}

function gaussian(random: () => number) {
  return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random())
}

/** mulberry32: the same seed gives the same fixture on every machine. */
function seededRandom(seed: number) {
  let state = seed

  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
