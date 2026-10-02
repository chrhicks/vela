import { z } from 'zod'
import type { WorkshopDesign, WorkshopFeature, WorkshopScenario } from './definitions'

export interface PreviewSelection {
  designId: string
  scenarioId: string
  mode: 'light' | 'dark'
  viewport: number | 'fit'
}

export interface SelectedPreview {
  selection: PreviewSelection
  design: WorkshopDesign
  scenario: WorkshopScenario
}

export type PreviewLocation =
  | { ok: true; preview: SelectedPreview }
  | { ok: false; message: string }

const savedSelectionSchema = z.object({
  designId: z.string(),
  scenarioId: z.string(),
  mode: z.enum(['light', 'dark']),
  viewport: z.union([z.literal('fit'), z.number().int().min(320).max(1920)]),
})

export function readSavedSelection(value: string | null): PreviewSelection | undefined {
  if (!value) return undefined

  try {
    const result = savedSelectionSchema.safeParse(JSON.parse(value))

    return result.success ? result.data : undefined
  } catch {
    return undefined
  }
}

export function resolvePreview(
  feature: WorkshopFeature,
  params: URLSearchParams,
  recovered?: PreviewSelection,
): PreviewLocation {
  const explicit = ['design', 'scenario', 'mode', 'viewport'].some(key => params.has(key))
  const saved = explicit ? undefined : recovered
  const designId = params.get('design') ?? saved?.designId ?? feature.defaultDesign
  const design = feature.designs.find(item => item.id === designId)

  if (!design) {
    if (saved) return resolvePreview(feature, params)

    return { ok: false, message: `The design “${designId}” is no longer available in ${feature.label}.` }
  }

  const scenarioId = params.get('scenario') ?? saved?.scenarioId ?? design.defaultScenario
  const scenario = design.scenarios.find(item => item.id === scenarioId)

  if (!scenario) {
    if (saved) return resolvePreview(feature, params)

    return { ok: false, message: `The scenario “${scenarioId}” is not available in ${design.label}.` }
  }

  const mode = params.get('mode') ?? saved?.mode ?? 'light'

  if (mode !== 'light' && mode !== 'dark')
    return { ok: false, message: 'Choose light or dark appearance in the preview link.' }

  const width = params.get('viewport') ?? saved?.viewport ?? 'fit'
  const viewport = width === 'fit' ? 'fit' : Number(width)

  if (viewport !== 'fit' && (!Number.isInteger(viewport) || viewport < 320 || viewport > 1920))
    return { ok: false, message: 'The preview width must be between 320 and 1920 pixels.' }

  return {
    ok: true,
    preview: { selection: { designId, scenarioId, mode, viewport }, design, scenario },
  }
}

export function featureHref(featureId: string, selection?: PreviewSelection): string {
  const path = `/features/${encodeURIComponent(featureId)}`

  if (!selection) return path

  const params = new URLSearchParams({
    design: selection.designId,
    scenario: selection.scenarioId,
    mode: selection.mode,
    viewport: String(selection.viewport),
  })

  return `${path}?${params}`
}

export function isDesignSystemLocation(url: URL): boolean {
  return url.pathname === '/gallery'
    || url.pathname === '/design-system'
    || url.pathname.startsWith('/design-system/')
    || (url.pathname === '/' && (url.searchParams.has('component') || url.searchParams.has('specimen')))
}
