import { referencePalette } from '@vela/ui/themes'
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
  {
    id: 'body',
    label: 'Text / surface',
    foreground: 'text',
    background: 'surface',
  },
  {
    id: 'muted',
    label: 'Muted text / surface',
    foreground: 'textMuted',
    background: 'surface',
  },
  {
    id: 'accent',
    label: 'Accent text / accent',
    foreground: 'accentText',
    background: 'accent',
  },
] as const

export function contrastFindings(theme: ThemeParameters): ContrastFinding[] {
  const palette = referencePalette(theme)

  return (['light', 'dark'] as const).flatMap(mode =>
    pairs.map(pair => {
      const foreground = palette[theme.semantic[mode][pair.foreground]]
      const background = palette[theme.semantic[mode][pair.background]]
      const ratio = contrastRatio(foreground, background)

      return {
        id: `${mode}-${pair.id}`,
        label: pair.label,
        mode,
        ratio,
        passes: ratio >= 4.5,
      }
    }),
  )
}

function contrastRatio(foreground: string, background: string): number {
  const light = Math.max(relativeLuminance(foreground), relativeLuminance(background))
  const dark = Math.min(relativeLuminance(foreground), relativeLuminance(background))

  return (light + 0.05) / (dark + 0.05)
}

function relativeLuminance(color: string): number {
  const match = color.match(/oklch\(([\d.]+) ([\d.]+) ([\d.-]+)\)/)

  if (!match) return 0
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
