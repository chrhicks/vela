import { createElement, type ComponentType, type ReactNode } from 'react'

export interface ScenarioDefinition<State> {
  id: string
  label: string
  description?: string
  tryThis?: string
  initialState: State
}

export interface DesignDefinition<State> {
  id: string
  label: string
  intent: string
  component: ComponentType<{ initialState: State }>
  defaultScenario: string
  scenarios: ScenarioDefinition<State>[]
}

export interface WorkshopScenario {
  id: string
  label: string
  description?: string
  tryThis?: string
  render: () => ReactNode
}

export interface WorkshopDesign {
  id: string
  label: string
  intent: string
  defaultScenario: string
  scenarios: WorkshopScenario[]
}

export interface WorkshopFeature {
  id: string
  label: string
  description: string
  collection: 'current' | 'past'
  thumbnail: {
    src: string
    alt: string
  }
  defaultDesign: string
  designs: WorkshopDesign[]
}

export function defineDesign<State>(definition: DesignDefinition<State>): WorkshopDesign {
  return {
    id: definition.id,
    label: definition.label,
    intent: definition.intent,
    defaultScenario: definition.defaultScenario,
    scenarios: definition.scenarios.map(({ initialState, ...scenario }) => ({
      ...scenario,
      render: () => createElement(definition.component, { initialState }),
    })),
  }
}

export function defineFeature(feature: WorkshopFeature): WorkshopFeature {
  return feature
}

export interface CatalogError {
  source: string
  path: string
  message: string
}

export interface FeatureModule {
  feature?: WorkshopFeature
}

export interface FeatureCatalogResult {
  features: WorkshopFeature[]
  errors: CatalogError[]
}

export function buildFeatureCatalog(modules: Record<string, FeatureModule>): FeatureCatalogResult {
  const features: WorkshopFeature[] = []
  const errors: CatalogError[] = []
  const featureSources = new Map<string, string>()

  for (const source of Object.keys(modules).sort()) {
    const feature = modules[source].feature

    const report = (path: string, message: string) => {
      errors.push({ source, path, message })
    }

    const checkText = (path: string, value: string) => {
      if (!value.trim()) report(path, 'Must not be empty')
    }

    const checkId = (path: string, value: string) => {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))
        report(path, 'Use a nonempty kebab-case ID')
    }

    if (!feature) {
      report('feature', 'Export a named feature created with defineFeature')
      continue
    }

    checkId('feature.id', feature.id)
    checkText('feature.label', feature.label)
    checkText('feature.description', feature.description)
    checkText('feature.thumbnail.src', feature.thumbnail.src)
    checkText('feature.thumbnail.alt', feature.thumbnail.alt)

    const previousSource = featureSources.get(feature.id)

    if (previousSource) report('feature.id', `Duplicate feature ID "${feature.id}"; also declared in ${previousSource}`)
    featureSources.set(feature.id, source)

    if (!feature.designs.length) report('feature.designs', 'Add at least one design')

    if (!feature.designs.some(design => design.id === feature.defaultDesign))
      report('feature.defaultDesign', `No design matches "${feature.defaultDesign}"`)

    const designIds = new Set<string>()

    for (const [designIndex, design] of feature.designs.entries()) {
      const path = `feature.designs[${designIndex}]`
      checkId(`${path}.id`, design.id)
      checkText(`${path}.label`, design.label)
      checkText(`${path}.intent`, design.intent)

      if (designIds.has(design.id)) report(`${path}.id`, `Duplicate design ID "${design.id}"`)
      designIds.add(design.id)

      if (!design.scenarios.length) report(`${path}.scenarios`, 'Add at least one scenario')

      if (!design.scenarios.some(scenario => scenario.id === design.defaultScenario))
        report(`${path}.defaultScenario`, `No scenario matches "${design.defaultScenario}"`)

      const scenarioIds = new Set<string>()

      for (const [scenarioIndex, scenario] of design.scenarios.entries()) {
        const scenarioPath = `${path}.scenarios[${scenarioIndex}]`
        checkId(`${scenarioPath}.id`, scenario.id)
        checkText(`${scenarioPath}.label`, scenario.label)

        if (scenarioIds.has(scenario.id)) report(`${scenarioPath}.id`, `Duplicate scenario ID "${scenario.id}"`)
        scenarioIds.add(scenario.id)
      }
    }

    features.push(feature)
  }

  return { features: errors.length ? [] : features, errors }
}
