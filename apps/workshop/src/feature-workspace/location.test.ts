import { describe, expect, it } from 'vitest'
import { defineDesign, defineFeature } from './definitions'
import { featureHref, isDesignSystemLocation, readSavedSelection, resolvePreview, type PreviewSelection } from './location'

const feature = defineFeature({
  id: 'framing',
  label: 'Framing',
  description: 'Explore framing',
  collection: 'current',
  thumbnail: { src: '/framing.webp', alt: 'Framing preview' },
  defaultDesign: 'beside-image',
  designs: ['beside-image', 'in-dialog'].map(id => defineDesign({
    id,
    label: id,
    intent: 'Explore sky context placement',
    component: ({ initialState }: { initialState: string }) => initialState,
    defaultScenario: 'ready',
    scenarios: ['ready', 'checked'].map(state => ({
      id: state,
      label: state,
      initialState: state,
    })),
  })),
})

const recovered: PreviewSelection = {
  designId: 'in-dialog',
  scenarioId: 'checked',
  mode: 'dark',
  viewport: 390,
}

const defaults: PreviewSelection = {
  designId: 'beside-image',
  scenarioId: 'ready',
  mode: 'light',
  viewport: 'fit',
}

describe('feature preview locations', () => {
  it('restores a valid saved selection only when the URL has no preview choices', () => {
    expect(resolvePreview(feature, new URLSearchParams(), recovered)).toMatchObject({
      ok: true,
      preview: { selection: recovered },
    })

    expect(resolvePreview(feature, new URLSearchParams('scenario=checked'), recovered)).toMatchObject({
      ok: true,
      preview: { selection: { ...defaults, scenarioId: 'checked' } },
    })

    const explicit = new URLSearchParams('design=beside-image&scenario=ready&mode=light&viewport=1440')
    expect(resolvePreview(feature, explicit, recovered)).toMatchObject({
      ok: true,
      preview: { selection: { ...defaults, viewport: 1440 } },
    })
  })

  it.each([
    undefined,
    { ...recovered, designId: 'removed-design' },
    { ...recovered, scenarioId: 'removed-scenario' },
  ])('opens defaults when recovery is absent or stale: %j', saved => {
    expect(resolvePreview(feature, new URLSearchParams(), saved)).toMatchObject({
      ok: true,
      preview: { selection: defaults },
    })
  })

  it.each([
    ['design=removed', 'design'],
    ['scenario=removed', 'scenario'],
    ['design=', 'design'],
    ['scenario=', 'scenario'],
    ['mode=system', 'appearance'],
    ['mode=', 'appearance'],
    ['viewport=319', 'width'],
    ['viewport=1921', 'width'],
    ['viewport=390.5', 'width'],
    ['viewport=wide', 'width'],
    ['viewport=', 'width'],
  ])('reports invalid explicit choices instead of recovering another view: %s', (query, problem) => {
    const result = resolvePreview(feature, new URLSearchParams(query), recovered)

    expect(result.ok).toBe(false)

    if (!result.ok) expect(result.message).toContain(problem)
  })

  it('roundtrips canonical starting conditions and resolves their actual design and scenario', () => {
    const url = new URL(featureHref(feature.id, recovered), 'http://workshop.test')
    const result = resolvePreview(feature, url.searchParams)

    expect(url.pathname).toBe('/features/framing')
    expect(result).toEqual({
      ok: true,
      preview: {
        selection: recovered,
        design: feature.designs[1],
        scenario: feature.designs[1].scenarios[1],
      },
    })
    expect(featureHref(feature.id)).toBe('/features/framing')
    expect(resolvePreview(feature, new URL(featureHref(feature.id, defaults), url).searchParams)).toMatchObject({
      ok: true,
      preview: { selection: defaults },
    })
  })

  it('escapes path and query values without allowing IDs to become navigation syntax', () => {
    const selection = { ...recovered, designId: 'a&mode=light', scenarioId: 'sky/#? +λ' }
    const featureId = 'frame/sky?# λ'
    const url = new URL(featureHref(featureId, selection), 'http://workshop.test')

    expect(decodeURIComponent(url.pathname.slice('/features/'.length))).toBe(featureId)
    expect(url.pathname.slice('/features/'.length)).not.toContain('/')
    expect(url.hash).toBe('')
    expect(url.searchParams.get('design')).toBe(selection.designId)
    expect(url.searchParams.get('scenario')).toBe(selection.scenarioId)
    expect(url.searchParams.getAll('mode')).toEqual(['dark'])
  })
})

describe('saved preview data', () => {
  it('accepts valid stored selection data', () => {
    expect(readSavedSelection(JSON.stringify(recovered))).toEqual(recovered)
    expect(readSavedSelection(JSON.stringify(defaults))).toEqual(defaults)
  })

  it.each([
    null, '', '{broken', 'null', '[]', '{}',
    JSON.stringify({ ...recovered, mode: 'system' }),
    JSON.stringify({ ...recovered, viewport: '390' }),
    JSON.stringify({ ...recovered, viewport: 2000 }),
    JSON.stringify({ ...recovered, scenarioId: 7 }),
  ])('ignores malformed saved data so it cannot select an invalid preview: %s', stored => {
    expect(readSavedSelection(stored)).toBeUndefined()
    expect(resolvePreview(feature, new URLSearchParams(), readSavedSelection(stored))).toMatchObject({
      ok: true,
      preview: { selection: defaults },
    })
  })
})

describe('legacy design-system routing', () => {
  it.each([
    '/?component=panel',
    '/?specimen=panel-frame-context',
    '/?component=panel&specimen=panel-frame-context',
    '/gallery',
    '/gallery?mode=dark',
    '/design-system',
    '/design-system/theme',
  ])('preserves access to the design system at %s', path => {
    expect(isDesignSystemLocation(new URL(path, 'http://workshop.test'))).toBe(true)
  })

  it.each(['/', '/features', '/features/framing', '/features/framing?component=panel', '/?mode=dark', '/design-systematic'])('keeps feature locations out of legacy routing: %s', path => {
    expect(isDesignSystemLocation(new URL(path, 'http://workshop.test'))).toBe(false)
  })
})
