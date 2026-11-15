import type { CatalogTarget } from './types.ts'

const emissionTypes: ReadonlySet<string> = new Set(['HII', 'SNR', 'SR?', 'PN', 'PN?', 'EN', 'BN', 'NB', 'ISM', 'GNe', 'EmO', 'C+N', 'EmN', 'Cl+N'])

export const dualBandHint = (target: CatalogTarget) => target.inHydrogenRegionCatalog === 1 || emissionTypes.has(target.type)
