import { RAMP_STEPS, SEMANTIC_TOKEN_KEYS, referencePalette } from '@vela/ui/themes'
import type { RampName, ReferenceToken, ThemeMode, ThemeParameters } from '@vela/ui/themes'

interface ThemeEditorProps {
  mode: ThemeMode
  theme: ThemeParameters
  onEdit: (patch: Partial<ThemeParameters>) => void
}

interface RangeFieldProps {
  label: string
  min: number
  max: number
  step: number
  value: number
  onChange: (value: number) => void
  suffix?: string
}

function RangeField({
  label,
  min,
  max,
  step,
  value,
  onChange,
  suffix = ''
}: RangeFieldProps) {
  return (
    <label className="control-field control-field--range">
      <span>{label}</span>
      <output>{value.toFixed(step < 0.01 ? 3 : step < 1 ? 2 : 0)}{suffix}</output>
      <input
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        type="range"
        value={value}
      />
    </label>
  )
}

export function ThemeEditor({ mode, theme, onEdit }: ThemeEditorProps) {
  const palette = referencePalette(theme)
  // SAFETY: referencePalette constructs only ReferenceToken keys from the fixed ramps.
  const referenceTokens = Object.keys(palette) as ReferenceToken[]

  function editLightness(ramp: RampName, index: number, value: number) {
    const key = `${ramp}Lightness` as const
    const next = [...theme[key]]
    next[index] = value
    onEdit({ [key]: next })
  }

  function editSemantic(key: (typeof SEMANTIC_TOKEN_KEYS)[number], value: ReferenceToken) {
    onEdit({
      semantic: {
        ...theme.semantic,
        [mode]: { ...theme.semantic[mode], [key]: value },
      },
    })
  }

  return (
    <div className="inspector-sections">
      <details open>
        <summary>Reference color</summary>
        <div className="inspector-section">
          <RangeField
            label="Neutral hue"
            max={360}
            min={0}
            onChange={(neutralHue) => onEdit({ neutralHue })}
            step={1}
            value={theme.neutralHue}
            suffix="°"
          />
          <RangeField
            label="Neutral chroma"
            max={0.08}
            min={0}
            onChange={(neutralChroma) => onEdit({ neutralChroma })}
            step={0.002}
            value={theme.neutralChroma}
          />
          <RangeField
            label="Accent hue"
            max={360}
            min={0}
            onChange={(accentHue) => onEdit({ accentHue })}
            step={1}
            value={theme.accentHue}
            suffix="°"
          />
          <RangeField
            label="Accent chroma"
            max={0.3}
            min={0.01}
            onChange={(accentChroma) => onEdit({ accentChroma })}
            step={0.005}
            value={theme.accentChroma}
          />
          {(['neutral', 'accent'] as const).map((ramp) => (
            <div className="ramp-editor" key={ramp}>
              <div className="section-label">{ramp} lightness</div>
              <div className="swatch-row">
                {RAMP_STEPS.map((step) => (
                  <span
                    key={step}
                    style={{ background: palette[`${ramp}-${step}`] }}
                    title={`${ramp}-${step}`}
                  />
                ))}
              </div>
              <div className="ramp-sliders">
                {RAMP_STEPS.map((step, index) => (
                  <label key={step} title={`${ramp}-${step}: ${Math.round((theme[`${ramp}Lightness`][index] ?? 0) * 100)}%`}>
                    <input
                      max={0.99}
                      min={0.05}
                      onChange={(event) => editLightness(ramp, index, Number(event.target.value))}
                      step={0.01}
                      type="range"
                      value={theme[`${ramp}Lightness`][index]}
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </details>

      <details>
        <summary>Status color ramps</summary>
        <div className="inspector-section">
          {(['positive', 'warning', 'danger'] as const).map((ramp) => (
            <div className="status-ramp" key={ramp}>
              <div className="status-ramp__heading">
                <span>{ramp}</span>
                <span>{theme[`${ramp}Hue`]}°</span>
              </div>
              <RangeField
                label="Hue"
                max={360}
                min={0}
                onChange={(value) => onEdit({ [`${ramp}Hue`]: value })}
                step={1}
                value={theme[`${ramp}Hue`]}
                suffix="°"
              />
              <RangeField
                label="Chroma"
                max={0.3}
                min={0.01}
                onChange={(value) => onEdit({ [`${ramp}Chroma`]: value })}
                step={0.005}
                value={theme[`${ramp}Chroma`]}
              />
              <div className="swatch-row">
                {RAMP_STEPS.map((step) => (
                  <span
                    key={step}
                    style={{ background: palette[`${ramp}-${step}`] }}
                    title={`${ramp}-${step}`}
                  />
                ))}
              </div>
              <div className="ramp-sliders">
                {RAMP_STEPS.map((step, index) => (
                  <label key={step} title={`${ramp}-${step}: ${Math.round((theme[`${ramp}Lightness`][index] ?? 0) * 100)}%`}>
                    <input
                      max={0.99}
                      min={0.05}
                      onChange={(event) => editLightness(ramp, index, Number(event.target.value))}
                      step={0.01}
                      type="range"
                      value={theme[`${ramp}Lightness`][index]}
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </details>

      <details>
        <summary>Semantic mapping · {mode}</summary>
        <div className="inspector-section semantic-grid">
          {SEMANTIC_TOKEN_KEYS.map((key) => (
            <label className="control-field" key={key}>
              <span>{key.replace(/[A-Z]/g, (value) => ` ${value.toLowerCase()}`)}</span>
              <div className="select-with-swatch">
                <i style={{ background: palette[theme.semantic[mode][key]] }} />
                <select
                  onChange={(event) => {
                    const token = referenceTokens.find(token => token === event.target.value)

                    if (token) editSemantic(key, token)
                  }}
                  value={theme.semantic[mode][key]}
                >
                  {referenceTokens.map((token) => <option key={token}>{token}</option>)}
                </select>
              </div>
            </label>
          ))}
        </div>
      </details>

      <details open>
        <summary>Typography & geometry</summary>
        <div className="inspector-section">
          <label className="control-field">
            <span>Font stack</span>
            <select
              onChange={(event) => {
                const fontStack = event.target.value

                if (fontStack === 'sans' || fontStack === 'serif' || fontStack === 'mono') onEdit({ fontStack })
              }}
              value={theme.fontStack}
            >
              <option value="sans">System sans</option>
              <option value="serif">System serif</option>
              <option value="mono">System mono</option>
            </select>
          </label>
          <RangeField
            label="Font size"
            max={18}
            min={11}
            onChange={(fontSize) => onEdit({ fontSize })}
            step={1}
            value={theme.fontSize}
            suffix="px"
          />
          <RangeField
            label="Font weight"
            max={750}
            min={300}
            onChange={(fontWeight) => onEdit({ fontWeight })}
            step={25}
            value={theme.fontWeight}
          />
          <RangeField
            label="Line height"
            max={1.8}
            min={1.1}
            onChange={(lineHeight) => onEdit({ lineHeight })}
            step={0.05}
            value={theme.lineHeight}
          />
          <RangeField
            label="Letter spacing"
            max={0.08}
            min={-0.04}
            onChange={(letterSpacing) => onEdit({ letterSpacing })}
            step={0.005}
            value={theme.letterSpacing}
            suffix="em"
          />
          <RangeField
            label="Spacing unit"
            max={8}
            min={2}
            onChange={(spacingUnit) => onEdit({ spacingUnit })}
            step={0.5}
            value={theme.spacingUnit}
            suffix="px"
          />
          <RangeField
            label="Corner radius"
            max={24}
            min={0}
            onChange={(radius) => onEdit({ radius })}
            step={1}
            value={theme.radius}
            suffix="px"
          />
          <RangeField
            label="Border width"
            max={3}
            min={0}
            onChange={(borderWidth) => onEdit({ borderWidth })}
            step={0.5}
            value={theme.borderWidth}
            suffix="px"
          />
          <RangeField
            label="Control height"
            max={52}
            min={28}
            onChange={(controlHeight) => onEdit({ controlHeight })}
            step={1}
            value={theme.controlHeight}
            suffix="px"
          />
          <RangeField
            label="Panel padding"
            max={32}
            min={8}
            onChange={(panelPadding) => onEdit({ panelPadding })}
            step={1}
            value={theme.panelPadding}
            suffix="px"
          />
        </div>
      </details>
    </div>
  )
}
