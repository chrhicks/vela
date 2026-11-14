import type { Source } from '../sources.ts'

const revision = '630fa8272f02e66c3a89d934b33f5a1cf063c204'
const folder = `https://raw.githubusercontent.com/Stellarium/stellarium/${revision}/nebulae/default`

export const objectsFile = { name: 'catalog.txt', address: `${folder}/catalog.txt` }
export const namesFile = { name: 'names.dat', address: `${folder}/names.dat` }

export const stellarium: Source = {
  id: 'stellarium',
  name: 'Stellarium DSO Catalog',
  authors: 'The Stellarium developers',
  version: `3.23 standard, revision ${revision}`,
  homepage: 'https://github.com/Stellarium/stellarium',
  license: 'GPL-2.0-or-later',
  files: [objectsFile, namesFile],
}
