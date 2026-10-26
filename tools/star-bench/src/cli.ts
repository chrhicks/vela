import { writeFile } from 'node:fs/promises'
import { availableParallelism } from 'node:os'
import { parseArgs } from 'node:util'
import { alertCountInput } from '@vela/server/alerts/frame'
import { runBench } from './bench.ts'

const usage = `Usage: star-bench SAVED_IMAGES_DIR [--frames LIST] [--table FILE] [--jobs N] [--gap-minutes N] [--restart-at TIME]... [--labels DIR] [--count measured|strong] [--sweep]

Measures saved frames with Vela's own measureStars, compares them with each frame's
metadata.json, and prints steadiness and alert episodes for each run of light frames.
Reads SAVED_IMAGES_DIR only. Exit 0 when every frame matches its record, 1 when not, 2 on bad usage.

  --frames LIST      measure only the frames listed, one path per line (a frame directory or its original.fits)
  --table FILE       write the per-frame table (tab separated) to FILE
  --jobs N           worker threads (default ${defaultJobs()})
  --gap-minutes N    start a new run after this gap between light frames (default 30)
  --restart-at TIME  start a new run at this UTC time, as an autofocus does in the monitor (repeatable)
  --labels DIR       check the alert replay against the per-night label files in DIR
  --count INPUT      the star count the alert replay reads: measured or strong (default ${alertCountInput})
  --sweep            with --labels, find how far each star threshold can move before a labelled night fails (slow)
`

function defaultJobs() {
  return Math.min(8, availableParallelism())
}

let parsed: ReturnType<typeof parseArguments>

try {
  parsed = parseArguments()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  console.error(usage)
  process.exit(2)
}

const { values, positionals } = parsed

const savedImages = positionals[0]

if (positionals.length !== 1 || savedImages === undefined) {
  console.error(usage)
  process.exit(2)
}

const jobs = Number(values.jobs ?? defaultJobs())

const gapMinutes = Number(values['gap-minutes'] ?? 30)

const restartTimes = (values['restart-at'] ?? []).map(Date.parse)

const count = values.count ?? alertCountInput

if (count !== 'measured' && count !== 'strong') {
  console.error('--count must be measured or strong')
  process.exit(2)
}

if (values.sweep && values.labels === undefined) {
  console.error('--sweep needs --labels')
  process.exit(2)
}

if (!Number.isInteger(jobs) || jobs < 1 || !(gapMinutes > 0) || restartTimes.some(Number.isNaN)) {
  console.error('--jobs must be a positive whole number, --gap-minutes a positive number and --restart-at a date')
  process.exit(2)
}

const result = await runBench(
  {
    savedImages,
    listFile: values.frames ?? null,
    jobs,
    gapMinutes,
    restartTimes,
    count,
    labelsDirectory: values.labels ?? null,
    sweep: values.sweep ?? false,
  },
  (done, total) => {
    if (done % 50 === 0 || done === total) console.error(`measured ${done} of ${total}`)
  },
)

if (values.table !== undefined) await writeFile(values.table, result.table)

process.stdout.write(result.report)

const { frames, elapsedSeconds, medianFrameSeconds } = result.timing

console.error(
  `measured ${frames} frames in ${elapsedSeconds.toFixed(0)} s with ${jobs} workers` +
    (medianFrameSeconds === null ? '' : `, median ${medianFrameSeconds.toFixed(2)} s per frame`),
)

process.exitCode = result.allMatch ? 0 : 1

function parseArguments() {
  return parseArgs({
    allowPositionals: true,
    options: {
      frames: { type: 'string' },
      table: { type: 'string' },
      jobs: { type: 'string' },
      'gap-minutes': { type: 'string' },
      'restart-at': { type: 'string', multiple: true },
      labels: { type: 'string' },
      count: { type: 'string' },
      sweep: { type: 'boolean' },
    },
  })
}
