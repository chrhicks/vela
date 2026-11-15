import { Effect, Schema } from 'effect'
import { SourceUnreadable } from '../sources.ts'
import { objectsFile, openNgc } from './source.ts'

const Text = Schema.NullOr(Schema.String)

export const OpenNgcObject = Schema.Struct({
  name: Schema.NonEmptyString,
  type: Schema.NonEmptyString,
  ra: Text,
  dec: Text,
  const: Text,
  majAx: Text,
  minAx: Text,
  posAng: Text,
  bMag: Text,
  vMag: Text,
  jMag: Text,
  hMag: Text,
  kMag: Text,
  surfBr: Text,
  hubble: Text,
  pax: Text,
  pmRa: Text,
  pmDec: Text,
  radVel: Text,
  redshift: Text,
  cstarUMag: Text,
  cstarBMag: Text,
  cstarVMag: Text,
  m: Text,
  ngc: Text,
  ic: Text,
  cstarNames: Text,
  identifiers: Text,
  commonNames: Text,
  nedNotes: Text,
  openNgcNotes: Text,
  sources: Text,
})

export type OpenNgcObject = typeof OpenNgcObject.Type

export const objectColumns = Object.keys(OpenNgcObject.fields)

const heading = 'Name;Type;RA;Dec;Const;MajAx;MinAx;PosAng;B-Mag;V-Mag;J-Mag;H-Mag;K-Mag;SurfBr;Hubble;Pax;Pm-RA;Pm-Dec;RadVel;Redshift;Cstar U-Mag;Cstar B-Mag;Cstar V-Mag;M;NGC;IC;Cstar Names;Identifiers;Common names;NED notes;OpenNGC notes;Sources'

const decode = Schema.decodeUnknownEffect(OpenNgcObject)

const unreadable = (line: number, reason: string) => new SourceUnreadable({ source: openNgc.id, file: objectsFile.name, line, reason })

export function fieldsOf(content: string): ReadonlyArray<string> {
  const fields: Array<string> = []
  let field = ''
  let quoted = false

  for (let at = 0; at < content.length; at += 1) {
    const character = content[at]!

    if (quoted && character === '"' && content[at + 1] === '"') {
      field += '"'
      at += 1
    } else if (character === '"') {
      quoted = !quoted
    } else if (character === ';' && !quoted) {
      fields.push(field)
      field = ''
    } else {
      field += character
    }
  }

  return [...fields, field]
}

function readLine(content: string, line: number) {
  const fields = fieldsOf(content)

  if (fields.length !== objectColumns.length) return Effect.fail(unreadable(line, `${fields.length} fields, expected ${objectColumns.length}`))

  const record = Object.fromEntries(objectColumns.map((column, index) => [column, fields[index] === '' ? null : fields[index]]))

  return decode(record).pipe(Effect.mapError(error => unreadable(line, error.message)))
}

export const readObjects = (text: string) => {
  const [first = '', ...rest] = text.split('\n').map(line => line.replace(/\r$/, ''))

  if (first !== heading) return Effect.fail(unreadable(1, 'the heading is not the one this reader was written for'))

  return Effect.forEach(
    rest.flatMap((content, index) => (content === '' ? [] : [{ content, line: index + 2 }])),
    ({ content, line }) => readLine(content, line),
  )
}
