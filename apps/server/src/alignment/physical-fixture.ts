import { readFileSync } from 'node:fs'
import { z } from 'zod'

const position = z.object({ raDegrees: z.number(), decDegrees: z.number() })

const capture = z.object({
  solved: position,
  capturedAt: z.string(),
  sidereal: z.number().optional(),
})

const physicalFixture = z.object({
  site: z.object({
    latitudeDegrees: z.number(),
    longitudeDegrees: z.number(),
    elevationMeters: z.number(),
  }),
  cases: z.array(
    z.object({
      altitude: z.number(),
      azimuth: z.number(),
      samples: z.tuple([capture, capture, capture]),
      adjusted: capture,
      target: position,
    }),
  ),
})

export const fixture = physicalFixture.parse(
  JSON.parse(readFileSync(new URL('./physical-coordinates.fixture.json', import.meta.url), 'utf8')),
)
