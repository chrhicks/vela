import { Caption } from '../../components/Caption.tsx'
import { Choices } from '../../components/Choices.tsx'
import styles from './TrendWindow.module.css'

export type TrendWindowName = 'hour' | 'run'

interface TrendWindowProps {
  readonly shown: TrendWindowName
  readonly onChoose: (shown: TrendWindowName) => void
}

export function TrendWindow({ shown, onChoose }: TrendWindowProps) {

  return (
    <div className={styles.window}>
      <Caption>Trends</Caption>

      <div className={styles.choices}>
        <Choices
          name="Trend window"
          choices={[
            { value: 'hour', label: 'Last hour' },
            { value: 'run', label: 'Whole run' },
          ]}
          chosen={shown}
          onChoose={onChoose}
        />
      </div>
    </div>
  )
}
