import type { Source } from '../sources.ts'

const revision = 'da90466031b0372c896588b85be6016c617e205b'

export const objectsFile = { name: 'NGC.csv', address: `https://raw.githubusercontent.com/mattiaverga/OpenNGC/${revision}/database_files/NGC.csv` }

export const openNgc: Source = {
  id: 'openngc',
  name: 'OpenNGC',
  authors: 'Mattia Verga and contributors',
  version: `revision ${revision}`,
  homepage: 'https://github.com/mattiaverga/OpenNGC',
  license: 'CC-BY-SA-4.0',
  files: [objectsFile],
}
