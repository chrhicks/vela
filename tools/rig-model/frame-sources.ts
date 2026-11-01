import { homedir } from 'node:os'
import { join } from 'node:path'
import { nightRows, pathsIn, scanFrameSources } from '@vela/rig-frames'

function option(name: string, fallback: string): string {
  const at = process.argv.indexOf(name)

  return at === -1 ? fallback : (process.argv[at + 1] ?? fallback)
}

const dataDirectory = option('--data', process.env.VELA_DATA_DIR ?? join(homedir(), '.local/share/vela'))

const utcOffsetMinutes = Number(option('--utc-offset-minutes', '0'))

const through = option('--through-night', '')

const sources = await scanFrameSources(pathsIn(dataDirectory))

const rows = nightRows(sources, utcOffsetMinutes).filter(row => through === '' || row.night <= through)

const count = (value: number) => String(value).padStart(6)

console.log('night       images  joined  before-records  no-record  trials')

for (const row of rows) console.log(`${row.night}  ${count(row.images)}  ${count(row.joined)}  ${String(row.predatesRecords).padStart(14)}  ${String(row.unexplained).padStart(9)}  ${count(row.trials.length)}`)

const sum = (pick: (row: (typeof rows)[number]) => number) => rows.reduce((total, row) => total + pick(row), 0)

console.log(`total       ${count(sum(row => row.images))}  ${count(sum(row => row.joined))}  ${String(sum(row => row.predatesRecords)).padStart(14)}  ${String(sum(row => row.unexplained)).padStart(9)}  ${count(sum(row => row.trials.length))}`)

console.log('')

console.log('alignment trials: night, run, started, outcome, journal frames / frame files kept, baselines, measurements')

for (const row of rows)
  for (const trial of row.trials)
    console.log(`  ${row.night}  ${trial.runId.slice(0, 8)}  ${new Date(trial.createdAt).toISOString()}  ${trial.outcome.padEnd(10)}  ${trial.frames.length}/${trial.frames.filter(frame => frame.onDisk).length}  ${trial.baselines}  ${trial.measurements}`)

const { join: joined, frameRecords, savedImages } = sources

const without = [...joined.recordsWithoutImageId].map(([outcome, total]) => `${total} ${outcome}`).join(', ')

console.log('')

console.log(`saved images ${savedImages.images.length}, frame records ${frameRecords.records.length}, joined by image.id ${joined.joined.length}`)

console.log(`  images captured before the first record, so none can exist: ${joined.imagesWithoutRecord.predatesRecords.length}`)

console.log(`  records for an image Vela did not keep (unsaved, save-failed): ${joined.recordsWithoutImage.notKept.length}`)

console.log(`  records that name no image: ${without === '' ? 'none' : without}`)

if (frameRecords.incompleteTail) console.log('  the last frame record is still being written and was left out')

const disagreeing = joined.joined.filter(item => item.disagreements.length > 0)

const failures = [
  ...(joined.imagesWithoutRecord.unexplained.length > 0 ? [`${joined.imagesWithoutRecord.unexplained.length} images captured after records began have no record`] : []),
  ...(joined.recordsWithoutImage.missing.length > 0 ? [`${joined.recordsWithoutImage.missing.length} records of saved images name an image the store lacks`] : []),
  ...(disagreeing.length > 0 ? [`${disagreeing.length} joined pairs disagree, the first on ${disagreeing[0]?.disagreements.join(', ')}`] : []),
  ...(joined.duplicates.length > 0 ? [`${joined.duplicates.length} repeated image ids`] : []),
  ...sources.problems.map(problem => `${problem.path.replace(dataDirectory, '<data>')}${problem.line === null ? '' : `:${problem.line}`}: ${problem.reason}`),
]

console.log(failures.length === 0 ? 'ok: every saved image is accounted for' : `FAIL\n  ${failures.join('\n  ')}`)

process.exit(failures.length === 0 ? 0 : 1)
