import { parseArgs } from 'node:util'
import { tmpdir } from 'node:os'
import { acceptSession, describe, formatAcceptance } from './accept.ts'
import { OutputInRepositoryError, refuseOutputInRepository } from './output-guard.ts'
import { buildSession } from './session.ts'
import { openPackage } from './query.ts'

const usage = `Usage:
  rig-session build --name <session> --from <iso> --to <iso> --out <dir>
                    [--saved-images <dir>] [--traces <file>] [--mount-csv <file>] [--frame-records <file>] [--recording <dir>] [--journal <file>]
                    [--allow-in-repo]
  rig-session accept --from <iso> --to <iso> [--scratch <dir>] [--allow-in-repo] [--allow-growth]
                    [--saved-images <dir>] [--traces <file>] [--mount-csv <file>] [--frame-records <file>] [--recording <dir>] [--journal <file>]
  rig-session query <package-dir> <sql>`

const inputOptions = {
  from: { type: 'string' },
  to: { type: 'string' },
  'saved-images': { type: 'string' },
  traces: { type: 'string' },
  'mount-csv': { type: 'string' },
  'frame-records': { type: 'string' },
  recording: { type: 'string' },
  journal: { type: 'string' },
  'allow-in-repo': { type: 'boolean' },
  'allow-growth': { type: 'boolean' },
} as const

const [command, ...rest] = process.argv.slice(2)

try {
  if (command === 'build') await build(rest)
  else if (command === 'accept') await accept(rest).catch(reportWithoutData)
  else if (command === 'query') await query(rest)
  else {
    console.error(usage)
    process.exitCode = 2
  }
} catch (error) {
  if (!(error instanceof OutputInRepositoryError)) throw error

  console.error(error.message)
  process.exitCode = 1
}

/** `accept` runs on private data, so an error it ends with is reduced to its kind: no path, no text from a file. */
function reportWithoutData(error: Error) {
  console.error(error instanceof OutputInRepositoryError ? error.message : `FAIL: ${describe(error)}`)
  process.exitCode = 1
}

/** The inputs and window both commands take, or null when the window is missing or not a time. */
function inputs(values: { readonly [Option in Exclude<keyof typeof inputOptions, 'allow-in-repo' | 'allow-growth'>]?: string | undefined }) {
  const window = { from: new Date(values.from ?? ''), to: new Date(values.to ?? '') }

  if (Number.isNaN(window.from.getTime()) || Number.isNaN(window.to.getTime())) return null

  return {
    window,
    savedImagesDir: values['saved-images'] ?? null,
    tracesFile: values.traces ?? null,
    mountCsvFile: values['mount-csv'] ?? null,
    frameRecordsFile: values['frame-records'] ?? null,
    recordingDir: values.recording ?? null,
    journalFile: values.journal ?? null,
  }
}

async function build(args: string[]) {
  const { values } = parseArgs({ args, options: { ...inputOptions, name: { type: 'string' }, out: { type: 'string' } } })
  const request = inputs(values)

  if (!values.name || !values.out || request === null) {
    console.error(usage)
    process.exitCode = 2

    return
  }

  await refuseOutputInRepository(values.out, values['allow-in-repo'] ?? false)

  console.log(`Built ${await buildSession({ ...request, name: values.name, root: values.out })}`)
}

async function accept(args: string[]) {
  const { values } = parseArgs({ args, options: { ...inputOptions, scratch: { type: 'string' } } })
  const request = inputs(values)

  if (request === null) {
    console.error(usage)
    process.exitCode = 2

    return
  }

  const scratch = values.scratch ?? tmpdir()

  await refuseOutputInRepository(scratch, values['allow-in-repo'] ?? false)

  const result = await acceptSession({ ...request, scratch, allowGrowth: values['allow-growth'] ?? false })

  console.log(formatAcceptance(result))
  process.exitCode = result.problems.length === 0 ? 0 : 1
}

async function query(args: string[]) {
  const [directory, sql] = args

  if (!directory || !sql) {
    console.error(usage)
    process.exitCode = 2

    return
  }

  const session = await openPackage(directory)

  console.table(await session.rows(sql))
  session.close()
}
