import { parseArgs } from 'node:util'
import { buildSession } from './session.ts'
import { openPackage } from './query.ts'

const usage = `Usage:
  rig-session build --name <session> --from <iso> --to <iso> --out <dir>
                    [--saved-images <dir>] [--traces <file>] [--mount-csv <file>] [--frame-records <file>] [--recording <dir>]
  rig-session query <package-dir> <sql>`

const [command, ...rest] = process.argv.slice(2)

if (command === 'build') await build(rest)
else if (command === 'query') await query(rest)
else {
  console.error(usage)
  process.exitCode = 2
}

async function build(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      name: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      out: { type: 'string' },
      'saved-images': { type: 'string' },
      traces: { type: 'string' },
      'mount-csv': { type: 'string' },
      'frame-records': { type: 'string' },
      recording: { type: 'string' },
    },
  })

  if (!values.name || !values.from || !values.to || !values.out) {
    console.error(usage)
    process.exitCode = 2

    return
  }

  const directory = await buildSession({
    name: values.name,
    window: { from: new Date(values.from), to: new Date(values.to) },
    root: values.out,
    savedImagesDir: values['saved-images'] ?? null,
    tracesFile: values.traces ?? null,
    mountCsvFile: values['mount-csv'] ?? null,
    frameRecordsFile: values['frame-records'] ?? null,
    recordingDir: values.recording ?? null,
  })

  console.log(`Built ${directory}`)
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
