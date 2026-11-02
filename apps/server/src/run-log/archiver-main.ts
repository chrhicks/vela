import { runArchiver } from './archiver.js'

const stop = new AbortController()

process.once('SIGTERM', () => stop.abort())

process.once('SIGINT', () => stop.abort())

try {
  await runArchiver({
    url: process.env.VELA_NATS_URL ?? 'nats://127.0.0.1:4222',
    credentialsFile: process.env.VELA_NATS_CREDENTIALS_FILE ?? '/data/nats/credentials.json',
    directory: process.env.VELA_ARCHIVE_DIR ?? '/mnt/storage/rig/archive',
    signal: stop.signal,
  })
} catch {
  if (!stop.signal.aborted) {
    process.stderr.write('Archiver stopped; check broker, private credential file and archive storage\n')
    process.exitCode = 1
  }
}
