import { z } from 'zod'
import { runShadowSolver } from './shadow.js'

const stop = new AbortController()

process.once('SIGTERM', () => stop.abort())

process.once('SIGINT', () => stop.abort())

try {
  await runShadowSolver({
    url: process.env.VELA_NATS_URL ?? 'nats://127.0.0.1:4222',
    credentialsFile: process.env.VELA_NATS_CREDENTIALS_FILE ?? '/credentials.json',
    imagesDirectory: process.env.VELA_SAVED_IMAGES_PATH ?? '/data/saved-images',
    astap: {
      executable: process.env.VELA_ASTAP ?? '/astap/astap_cli',
      catalogPath: process.env.VELA_STAR_CATALOG ?? '/astap/catalog/opt/astap',
      fieldHeightDegrees: z.coerce.number().positive().max(90).parse(process.env.VELA_SOLVER_FIELD_HEIGHT_DEGREES),
      timeoutMs: 60_000,
    },
    signal: stop.signal,
  })
} catch {
  if (!stop.signal.aborted) {
    process.stderr.write('Shadow solver stopped; check broker, private credentials, images and ASTAP configuration\n')
    process.exitCode = 1
  }
}
