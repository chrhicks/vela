import { Effect } from 'effect'
import { expect, test } from 'vitest'
import { readObjects } from './objects.ts'
import { objectLine } from './testing.ts'

const read = (text: string) => Effect.runPromise(Effect.result(readObjects(text)))

test('an object line becomes one object with its numbers read and its blanks empty', async () => {
  const result = await read(['# Stellarium DSO catalog', objectLine({ dso: '7', ra: '314.75', dec: '+44.33  ', vMag: '4', type: 'HII  ', majorAxis: '120', ngc: '7000', c: '20', ced: '183' }), ''].join('\n'))

  expect(result).toMatchObject({ _tag: 'Success', success: [{ dso: 7, ra: 314.75, dec: 44.33, bMag: 99, vMag: 4, type: 'HII', morphology: null, majorAxis: 120, minorAxis: 0, ngc: 7000, c: 20, sh2: null, ced: '183', pk: null }] })
})

test('a line with the wrong number of fields is reported with its line number', async () => {
  const result = await read(`# header\n${objectLine({ dso: '1' })}\n1\t2\t3`)

  expect(result).toMatchObject({ _tag: 'Failure', failure: { _tag: 'SourceUnreadable', source: 'stellarium', file: 'catalog.txt', line: 3, reason: '3 fields, expected 45' } })
})

test('a number that is not a number is reported with its line number', async () => {
  const result = await read(objectLine({ dso: '1', ra: 'east' }))

  expect(result).toMatchObject({ _tag: 'Failure', failure: { _tag: 'SourceUnreadable', line: 1 } })
})
