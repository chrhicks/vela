import type { ComponentSpecimen } from '@vela/ui/themes'

interface SpecimenModule {
  specimen: ComponentSpecimen
}

const modules = import.meta.glob<SpecimenModule>(
  '../../../packages/ui/src/{components,drafts}/*.specimen.tsx',
  { eager: true },
)

const discoveredSpecimens = Object.entries(modules)
  .map(([path, module]) => ({
    specimen: module.specimen,
    stability: path.includes('/components/') ? 'stable' as const : 'draft' as const,
  }))
  .sort((left, right) => left.specimen.componentName.localeCompare(right.specimen.componentName))

export const specimens = discoveredSpecimens.map((entry) => entry.specimen)

const groupedSpecimens = discoveredSpecimens.reduce<Record<string, { stability: 'stable' | 'draft'; specimens: ComponentSpecimen[] }>>((groups, entry) => {
  const group = groups[entry.specimen.componentId] ?? { stability: entry.stability, specimens: [] }
  group.specimens.push(entry.specimen)
  if (entry.stability === 'stable') group.stability = 'stable'
  groups[entry.specimen.componentId] = group
  return groups
}, {})

export const componentGroups = Object.entries(groupedSpecimens).map(([id, group]) => ({
  id,
  name: group.specimens[0]?.componentName ?? id,
  specimens: group.specimens,
  stability: group.stability,
}))

export function findSpecimen(componentId: string, specimenId: string): ComponentSpecimen {
  return specimens.find((entry) => entry.componentId === componentId && entry.id === specimenId)
    ?? specimens[0]
    ?? failMissingSpecimen()
}

function failMissingSpecimen(): never {
  throw new Error('No component specimens were discovered')
}
