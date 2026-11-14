import { Effect, Schema } from 'effect'
import { SourceUnreadable } from '../sources.ts'
import { objectsFile, stellarium } from './source.ts'

const Quantity = Schema.NullOr(Schema.FiniteFromString)
const Text = Schema.NullOr(Schema.String)

export const StellariumObject = Schema.Struct({
  dso: Schema.FiniteFromString,
  ra: Schema.FiniteFromString,
  dec: Schema.FiniteFromString,
  bMag: Quantity,
  vMag: Quantity,
  type: Text,
  morphology: Text,
  majorAxis: Quantity,
  minorAxis: Quantity,
  orientation: Quantity,
  redshift: Quantity,
  redshiftError: Quantity,
  parallax: Quantity,
  parallaxError: Quantity,
  distance: Quantity,
  distanceError: Quantity,
  ngc: Quantity,
  ic: Quantity,
  m: Quantity,
  c: Quantity,
  b: Quantity,
  sh2: Quantity,
  vdb: Quantity,
  rcw: Quantity,
  ldn: Quantity,
  lbn: Quantity,
  cr: Quantity,
  mel: Quantity,
  pgc: Quantity,
  ugc: Quantity,
  ced: Text,
  arp: Quantity,
  vv: Quantity,
  pk: Text,
  png: Text,
  snrg: Text,
  aco: Text,
  hcg: Text,
  eso: Text,
  vdbh: Text,
  dwb: Quantity,
  tr: Quantity,
  st: Quantity,
  ru: Quantity,
  vdbha: Quantity,
})

export type StellariumObject = typeof StellariumObject.Type

export const objectColumns = Object.keys(StellariumObject.fields)

export const objectColumnDefinitions = Object.entries(StellariumObject.fields).map(([column, schema]) => `${column} ${schema === Text ? 'TEXT' : 'NUMERIC'}`)

const decode = Schema.decodeUnknownEffect(StellariumObject)

const unreadable = (line: number, reason: string) => new SourceUnreadable({ source: stellarium.id, file: objectsFile.name, line, reason })

function readLine(text: string, line: number) {
  const fields = text.split('\t').map(field => field.trim())

  if (fields.length !== objectColumns.length) return Effect.fail(unreadable(line, `${fields.length} fields, expected ${objectColumns.length}`))

  const record = Object.fromEntries(objectColumns.map((column, index) => [column, fields[index] === '' ? null : fields[index]]))

  return decode(record).pipe(Effect.mapError(error => unreadable(line, error.message)))
}

export const readObjects = (text: string) =>
  Effect.forEach(
    text.split('\n').flatMap((content, index) => (content.trim() === '' || content.startsWith('#') ? [] : [{ content, line: index + 1 }])),
    ({ content, line }) => readLine(content, line),
  )
