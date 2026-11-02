import { recoverFacts } from '../../src/rig-model/recovery.js'
import { createStreamModel } from '../../src/rig-model/stream.js'
import { readArchive } from '../../src/run-log/archive.js'

const [directory, state, through, mode] = process.argv.slice(2)

if (!directory || !state || !through) throw new Error('Missing recovery fixture args')

const runtime = createStreamModel()

const records = mode === 'buffered' ? readArchive(directory, { from: 0, to: 253402300799999 }) : recoverFacts(directory, state, Number(through))

let count = 0

for await (const record of records) {
  count++

  if (record.broker?.sequence !== count) throw new Error('Recovery did not preserve broker order')
  runtime.accept(record)
}

process.stdout.write(JSON.stringify({ count, sequence: runtime.snapshot().sequences.get('RIG_FACTS') }) + '\n')
