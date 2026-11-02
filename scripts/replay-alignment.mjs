import { resolve } from 'node:path'
import { replayAlignmentDiagnostics } from '../apps/server/dist/alignment/diagnostic-replay.js'

try {
  if (process.argv.length < 3 || process.argv.length > 4 || !process.argv[2]) {
    throw new Error(
      'Usage: node scripts/replay-alignment.mjs /path/to/trial-directory [/path/to/run-log] (build @vela/server first)',
    )
  }

  const result = await replayAlignmentDiagnostics(resolve(process.argv[2]), process.argv[3] ? resolve(process.argv[3]) : undefined)
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Alignment replay failed')
  process.exitCode = 1
}
