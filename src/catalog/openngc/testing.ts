import { objectColumns, type OpenNgcObject } from './objects.ts'

export const heading = 'Name;Type;RA;Dec;Const;MajAx;MinAx;PosAng;B-Mag;V-Mag;J-Mag;H-Mag;K-Mag;SurfBr;Hubble;Pax;Pm-RA;Pm-Dec;RadVel;Redshift;Cstar U-Mag;Cstar B-Mag;Cstar V-Mag;M;NGC;IC;Cstar Names;Identifiers;Common names;NED notes;OpenNGC notes;Sources'

export const objectLine = (given: Partial<Record<keyof OpenNgcObject, string>>) => {
  const values: Readonly<Record<string, string>> = given

  return objectColumns.map(column => values[column] ?? '').join(';')
}
