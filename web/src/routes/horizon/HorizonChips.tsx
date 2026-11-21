import { layerChips, type Layer } from '../../../../state/horizon-layers.ts'
import styles from './HorizonChips.module.css'

interface HorizonChipsProps {
  readonly layers: ReadonlySet<Layer>
  readonly onToggle: (layer: Layer) => void
}

export function HorizonChips({ layers, onToggle }: HorizonChipsProps) {
  return (
    <div className={styles.row} role="group" aria-label="Layers on the chart">
      {layerChips.map(chip => (
        <button key={chip.layer} type="button" className={styles.chip} aria-pressed={layers.has(chip.layer)} onClick={() => onToggle(chip.layer)}>
          <span className={styles.letter}>{chip.letter}</span>
          {chip.label}
        </button>
      ))}

      <span className={styles.always}>Trees and path always on</span>
    </div>
  )
}
