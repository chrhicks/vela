import { objectColumns, type StellariumObject } from './objects.ts'

const none: Readonly<Record<string, string>> = { bMag: '99', vMag: '99', type: '', morphology: '', ced: '', pk: '', png: '', snrg: '', aco: '', hcg: '', eso: '', vdbh: '', sh2: '', pgc: '' }

export const objectLine = (given: Partial<Record<keyof StellariumObject, string>>) => {
  const values: Readonly<Record<string, string>> = { ...none, ...given }

  return objectColumns.map(column => values[column] ?? '0').join('\t')
}

export const nameLine = (prefix: string, identifier: string, name: string, citations?: string) => `${prefix.padEnd(5)}${identifier.padEnd(15)}_("${name}")${citations === undefined ? '' : ` # ${citations}`}`
