import { runArchiver } from '../../src/run-log/archiver.js'

const stop = new AbortController()

process.once('SIGTERM', () => {
  if (process.env.TEST_PAUSE_BATCH !== '1') stop.abort()
})

try {
  await runArchiver({
    url: process.env.TEST_NATS_URL!,
    credentialsFile: process.env.TEST_NATS_CREDENTIALS!,
    directory: process.env.TEST_ARCHIVE_DIR!,
    signal: stop.signal,
    async onDurableBatch() {
      process.send?.('durable-before-ack')

      if (process.env.TEST_PAUSE_BATCH === '1') await new Promise(() => {})
    },
  })
} catch {
  if (!stop.signal.aborted) process.exitCode = 1
} finally { process.disconnect?.() }
