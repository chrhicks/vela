import { describe, expect, it } from 'vitest'
import { isValidElement } from 'react'
import { buildFeatureCatalog, defineDesign, defineFeature, type WorkshopFeature } from './definitions'

function feature(id = 'framing'): WorkshopFeature {
  return defineFeature({
    id,
    label: 'Framing',
    description: 'Explore framing a target',
    collection: 'current',
    thumbnail: { src: '/framing.webp', alt: 'A framed target' },
    defaultDesign: 'sky-beside-image',
    designs: [defineDesign({
      id: 'sky-beside-image',
      label: 'Sky beside the image',
      intent: 'Keep sky context visible',
      component: ({ initialState }: { initialState: { offset: number } }) => String(initialState.offset),
      defaultScenario: 'solved',
      scenarios: [{ id: 'solved', label: 'Frame solved', initialState: { offset: 2.4 } }],
    })],
  })
}

describe('feature authoring', () => {
  it('keeps differently typed designs renderable without losing their fixture input', () => {
    const framing = feature()

    const ready = defineDesign({
      id: 'ready',
      label: 'Ready',
      intent: 'Try the empty state',
      component: ({ initialState }: { initialState: { target: string } }) => initialState.target,
      defaultScenario: 'empty',
      scenarios: [{ id: 'empty', label: 'Empty', initialState: { target: 'M31' } }],
    })

    framing.designs.push(ready)
    const catalog = buildFeatureCatalog({ 'framing.feature.tsx': { feature: framing } })

    expect(catalog.errors).toEqual([])
    const rendered = catalog.features[0].designs.map(design => design.scenarios[0].render())
    expect(rendered.every(isValidElement)).toBe(true)
    expect(rendered[0]).toMatchObject({ props: { initialState: { offset: 2.4 } } })
    expect(rendered[1]).toMatchObject({ props: { initialState: { target: 'M31' } } })
  })

  it('reports duplicate IDs at their owning source and scope without publishing a partial catalog', () => {
    const duplicate = feature()
    duplicate.designs[0].scenarios.push(duplicate.designs[0].scenarios[0])
    duplicate.designs.push(duplicate.designs[0])
    const first = { feature: feature() }
    const second = { feature: duplicate }
    const result = buildFeatureCatalog({ 'b.feature.tsx': second, 'a.feature.tsx': first })

    expect(result.features).toEqual([])
    expect(result.errors).toEqual(expect.arrayContaining([
      { source: 'b.feature.tsx', path: 'feature.id', message: 'Duplicate feature ID "framing"; also declared in a.feature.tsx' },
      { source: 'b.feature.tsx', path: 'feature.designs[1].id', message: 'Duplicate design ID "sky-beside-image"' },
      { source: 'b.feature.tsx', path: 'feature.designs[0].scenarios[1].id', message: 'Duplicate scenario ID "solved"' },
    ]))
    expect(buildFeatureCatalog({ 'a.feature.tsx': first, 'b.feature.tsx': second })).toEqual(result)
  })

  it('points authors to invalid defaults and empty design or scenario lists', () => {
    const emptyDesign = feature('empty-design')
    emptyDesign.designs = []
    const emptyScenario = feature('empty-scenario')
    emptyScenario.designs[0].scenarios = []

    const result = buildFeatureCatalog({
      'empty-design.feature.tsx': { feature: emptyDesign },
      'empty-scenario.feature.tsx': { feature: emptyScenario },
    })

    expect(result.features).toEqual([])
    expect(result.errors.map(error => [error.source, error.path])).toEqual([
      ['empty-design.feature.tsx', 'feature.designs'],
      ['empty-design.feature.tsx', 'feature.defaultDesign'],
      ['empty-scenario.feature.tsx', 'feature.designs[0].scenarios'],
      ['empty-scenario.feature.tsx', 'feature.designs[0].defaultScenario'],
    ])
  })

  it('rejects missing exports, empty author-facing text and malformed IDs', () => {
    const invalid = feature('Frame Solved')
    invalid.label = ' '
    invalid.designs[0].intent = ''
    invalid.designs[0].scenarios[0].label = ''

    const result = buildFeatureCatalog({
      'missing.feature.tsx': {},
      'invalid.feature.tsx': { feature: invalid },
    })

    expect(result.features).toEqual([])
    expect(result.errors.map(error => error.path)).toEqual([
      'feature.id', 'feature.label', 'feature.designs[0].intent',
      'feature.designs[0].scenarios[0].label', 'feature',
    ])
  })
})
