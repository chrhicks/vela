import { buildFeatureCatalog, type FeatureModule } from './definitions'

const modules = import.meta.glob<FeatureModule>('../features/**/*.feature.tsx', { eager: true })

const catalog = buildFeatureCatalog(modules)

export const featureCatalog = catalog.features

export const catalogErrors = catalog.errors
