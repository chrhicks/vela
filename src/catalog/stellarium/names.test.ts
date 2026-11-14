import { Effect } from 'effect'
import { expect, test } from 'vitest'
import { readNames } from './names.ts'
import { nameLine } from './testing.ts'

const read = (text: string) => Effect.runPromise(Effect.result(readNames(text)))

test('a name record carries its catalog prefix, identifier, name and citations', async () => {
  const result = await read(['# Stellarium DSO Catalog Names', nameLine('NGC', '7000', 'North America Nebula', 'WK, DSW'), nameLine('SH2', '132', 'Lion Nebula'), nameLine('', '47', 'Cygnus Star Cloud', 'S&T')].join('\n'))

  expect(result).toMatchObject({
    _tag: 'Success',
    success: [
      { line: 2, prefix: 'NGC', identifier: '7000', name: 'North America Nebula', citations: 'WK, DSW' },
      { line: 3, prefix: 'SH2', identifier: '132', name: 'Lion Nebula', citations: null },
      { line: 4, prefix: '', identifier: '47', name: 'Cygnus Star Cloud', citations: 'S&T' },
    ],
  })
})

test('a line that is not a name record is reported with its line number', async () => {
  const result = await read(`${nameLine('NGC', '7000', 'North America Nebula')}\nNGC  7000 North America`)

  expect(result).toMatchObject({ _tag: 'Failure', failure: { _tag: 'SourceUnreadable', source: 'stellarium', file: 'names.dat', line: 2 } })
})
