import { semanticPalette } from '@vela/ui/themes'
import type { ThemeMode, ThemeParameters } from '@vela/ui/themes'

export interface ContrastFinding {
  id: string
  label: string
  mode: ThemeMode
  ratio: number
  passes: boolean
}

export interface SourceFinding {
  file: string
  value: string
}

const sourceModules = import.meta.glob<string>(
  [
    '../../../packages/ui/src/{components,drafts}/*.{ts,tsx}',
    '../../../packages/ui/src/styles.css',
  ],
  { eager: true, query: '?raw', import: 'default' },
)

export const sourceFindings: SourceFinding[] = Object.entries(sourceModules).flatMap(
  ([file, source]) => {
    const values = source.match(/#[\da-f]{3,8}\b|(?:rgb|hsl|oklch)\([^)]*\)/gi) ?? []

    return [...new Set(values)].map(value => ({
      file: file.split('/packages/ui/')[1] ?? file,
      value,
    }))
  },
)

const pairs = [
  { id: 'body', label: 'Text / surface', foreground: 'text', background: 'surface', minimum: 4.5 },
  { id: 'canvas', label: 'Text / canvas', foreground: 'text', background: 'canvas', minimum: 4.5 },
  { id: 'raised', label: 'Text / raised surface', foreground: 'text', background: 'surfaceRaised', minimum: 4.5 },
  { id: 'muted', label: 'Muted text / surface', foreground: 'textMuted', background: 'surface', minimum: 4.5 },
  { id: 'muted-canvas', label: 'Muted text / canvas', foreground: 'textMuted', background: 'canvas', minimum: 4.5 },
  { id: 'muted-raised', label: 'Muted text / raised surface', foreground: 'textMuted', background: 'surfaceRaised', minimum: 4.5 },
  { id: 'accent', label: 'Action text / action', foreground: 'accentText', background: 'accent', minimum: 4.5 },
  { id: 'accent-hover', label: 'Action text / hover', foreground: 'accentText', background: 'accentHover', minimum: 4.5 },
  { id: 'accent-pressed', label: 'Action text / pressed', foreground: 'accentText', background: 'accentPressed', minimum: 4.5 },
  { id: 'warning', label: 'Warning text / warning surface', foreground: 'warning', background: 'warningSurface', minimum: 4.5 },
  { id: 'danger', label: 'Error text / error surface', foreground: 'danger', background: 'dangerSurface', minimum: 4.5 },
  { id: 'focus', label: 'Focus / canvas', foreground: 'focus', background: 'canvas', minimum: 3 },
  { id: 'control', label: 'Control edge / raised surface', foreground: 'lineStrong', background: 'surfaceRaised', minimum: 3 },
] as const

export function contrastFindings(theme: ThemeParameters): ContrastFinding[] {
  return (['light', 'dark'] as const).flatMap(mode =>
    pairs.map(pair => {
      const palette = semanticPalette(theme, mode)
      const foreground = palette[pair.foreground]
      const background = palette[pair.background]
      const ratio = contrastRatio(foreground, background)

      return {
        id: `${mode}-${pair.id}`,
        label: pair.label,
        mode,
        ratio,
        passes: ratio >= pair.minimum,
      }
    }),
  )
}

export function contrastRatio(foreground: string, background: string): number {
  const light = Math.max(relativeLuminance(foreground), relativeLuminance(background))
  const dark = Math.min(relativeLuminance(foreground), relativeLuminance(background))

  return (light + 0.05) / (dark + 0.05)
}

function relativeLuminance(color: string): number {
  if (/^#[\da-f]{6}$/i.test(color)) {
    const channels = [1, 3, 5].map(index => {
      const channel = Number.parseInt(color.slice(index, index + 2), 16) / 255

      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    })

    return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
  }

  const match = color.match(/oklch\(([\d.]+) ([\d.]+) ([\d.-]+)\)/)

  if (!match) throw new Error(`Unsupported resolved color: ${color}`)
  const lightness = Number(match[1])
  const chroma = Number(match[2])
  const hue = (Number(match[3]) * Math.PI) / 180
  const a = chroma * Math.cos(hue)
  const b = chroma * Math.sin(hue)
  const lRoot = lightness + 0.3963377774 * a + 0.2158037573 * b
  const mRoot = lightness - 0.1055613458 * a - 0.0638541728 * b
  const sRoot = lightness - 0.0894841775 * a - 1.291485548 * b
  const l = lRoot ** 3
  const m = mRoot ** 3
  const s = sRoot ** 3
  const red = clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)
  const green = clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)
  const blue = clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value))
}
