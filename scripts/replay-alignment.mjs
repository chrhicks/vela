import { resolve } from 'node:path'
import { replayAlignmentDiagnostics } from '../apps/server/dist/alignment/diagnostic-replay.js'

try {
  if (process.argv.length !== 3 || !process.argv[2]) {
    throw new Error('Usage: node scripts/replay-alignment.mjs /path/to/trial-directory (build @vela/server first)')
  }

  const result = await replayAlignmentDiagnostics(resolve(process.argv[2]))
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Alignment replay failed')
  process.exitCode = 1
}
