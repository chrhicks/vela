import { Effect } from 'effect'
import { expect, test } from 'vitest'
import { fieldsOf, readObjects } from './objects.ts'
import { heading, objectLine } from './testing.ts'

const read = (text: string) => Effect.runPromise(Effect.result(readObjects(text)))

test('a line becomes one object, every field as the file gives it and blanks empty', async () => {
  const result = await read([heading, objectLine({ name: 'NGC5907', type: 'G', ra: '15:15:53.77', dec: '+56:19:43.6', const: 'Dra', majAx: '11.30', ngc: '5906' }), ''].join('\n'))

  expect(result).toMatchObject({ _tag: 'Success', success: [{ name: 'NGC5907', type: 'G', ra: '15:15:53.77', dec: '+56:19:43.6', const: 'Dra', majAx: '11.30', minAx: null, ngc: '5906', commonNames: null }] })
})

test('a quoted field may hold the separator', () => {
  expect(fieldsOf('NGC0001;G;"a; b";"said ""so""";')).toEqual(['NGC0001', 'G', 'a; b', 'said "so"', ''])
})

test('a file with another heading is not read', async () => {
  expect(await read('Name;Type\nNGC0001;G')).toMatchObject({ _tag: 'Failure', failure: { _tag: 'SourceUnreadable', source: 'openngc', file: 'NGC.csv', line: 1 } })
})

test('a line with the wrong number of fields is reported with its line number', async () => {
  expect(await read([heading, objectLine({ name: 'NGC0001', type: 'G' }), 'NGC0002;G'].join('\n'))).toMatchObject({ _tag: 'Failure', failure: { _tag: 'SourceUnreadable', line: 3, reason: '2 fields, expected 32' } })
})
