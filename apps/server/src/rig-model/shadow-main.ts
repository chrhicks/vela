import { runShadowModel } from './shadow.js'

const stop = new AbortController()

process.once('SIGTERM', () => stop.abort())

process.once('SIGINT', () => stop.abort())

try {
  await runShadowModel({
    url: process.env.VELA_NATS_URL ?? 'nats://127.0.0.1:4222',
    credentialsFile: process.env.VELA_NATS_CREDENTIALS_FILE ?? '/credentials.json',
    directory: process.env.VELA_MODEL_STATE_DIR ?? '/data/model',
    signal: stop.signal,
  })
} catch {
  if (!stop.signal.aborted) {
    process.stderr.write('Shadow model stopped; check broker, private credentials and model storage\n')
    process.exitCode = 1
  }
}
