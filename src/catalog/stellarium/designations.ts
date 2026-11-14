import type { StellariumObject } from './objects.ts'

export interface Designation {
  readonly column: keyof StellariumObject
  readonly prefix: string
  readonly label: string
  readonly numbered: boolean
}

export const designationsInNamingOrder: ReadonlyArray<Designation> = [
  { column: 'm', prefix: 'M', label: 'M ', numbered: true },
  { column: 'ngc', prefix: 'NGC', label: 'NGC ', numbered: true },
  { column: 'ic', prefix: 'IC', label: 'IC ', numbered: true },
  { column: 'c', prefix: 'C', label: 'C ', numbered: true },
  { column: 'b', prefix: 'B', label: 'B ', numbered: true },
  { column: 'sh2', prefix: 'SH2', label: 'Sh2-', numbered: true },
  { column: 'vdb', prefix: 'VDB', label: 'vdB ', numbered: true },
  { column: 'rcw', prefix: 'RCW', label: 'RCW ', numbered: true },
  { column: 'ldn', prefix: 'LDN', label: 'LDN ', numbered: true },
  { column: 'lbn', prefix: 'LBN', label: 'LBN ', numbered: true },
  { column: 'cr', prefix: 'CR', label: 'Cr ', numbered: true },
  { column: 'mel', prefix: 'MEL', label: 'Mel ', numbered: true },
  { column: 'ced', prefix: 'CED', label: 'Ced ', numbered: false },
  { column: 'dwb', prefix: 'DWB', label: 'DWB ', numbered: true },
  { column: 'tr', prefix: 'TR', label: 'Tr ', numbered: true },
  { column: 'st', prefix: 'ST', label: 'St ', numbered: true },
  { column: 'ru', prefix: 'RU', label: 'Ru ', numbered: true },
  { column: 'vdbha', prefix: 'VDBHA', label: 'vdB-Ha ', numbered: true },
  { column: 'arp', prefix: 'ARP', label: 'Arp ', numbered: true },
  { column: 'vv', prefix: 'VV', label: 'VV ', numbered: true },
  { column: 'hcg', prefix: 'HCG', label: 'HCG ', numbered: false },
  { column: 'aco', prefix: 'ACO', label: 'Abell ', numbered: false },
  { column: 'pk', prefix: 'PK', label: 'PK ', numbered: false },
  { column: 'png', prefix: 'PNG', label: 'PN G', numbered: false },
  { column: 'snrg', prefix: 'SNRG', label: 'SNR G', numbered: false },
  { column: 'eso', prefix: 'ESO', label: 'ESO ', numbered: false },
  { column: 'vdbh', prefix: 'VDBH', label: 'vdBH ', numbered: false },
  { column: 'ugc', prefix: 'UGC', label: 'UGC ', numbered: true },
  { column: 'pgc', prefix: 'PGC', label: 'PGC ', numbered: true },
]
