import type { ComponentSpecimen } from '@vela/ui/themes'

interface SpecimenModule {
  specimen: ComponentSpecimen
}

const modules = import.meta.glob<SpecimenModule>(
  '../../../packages/ui/src/drafts/*.specimen.tsx',
  { eager: true },
)

export const specimens = Object.values(modules)
  .map((module) => module.specimen)
  .sort((left, right) => left.componentName.localeCompare(right.componentName))

const groupedSpecimens = specimens.reduce<Record<string, ComponentSpecimen[]>>((groups, specimen) => {
  const group = groups[specimen.componentId] ?? []
  group.push(specimen)
  groups[specimen.componentId] = group
  return groups
}, {})

export const componentGroups = Object.entries(groupedSpecimens).map(([id, entries]) => ({
  id,
  name: entries[0]?.componentName ?? id,
  specimens: entries,
}))

export function findSpecimen(componentId: string, specimenId: string): ComponentSpecimen {
  return specimens.find((entry) => entry.componentId === componentId && entry.id === specimenId)
    ?? specimens[0]
    ?? failMissingSpecimen()
}

function failMissingSpecimen(): never {
  throw new Error('No component specimens were discovered')
}
