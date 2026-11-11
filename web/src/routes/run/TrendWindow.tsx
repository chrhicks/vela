import { useState } from 'react'

import { Caption } from '../../components/Caption.tsx'
import { Choices } from '../../components/Choices.tsx'
import styles from './TrendWindow.module.css'

type Window = 'hour' | 'run'

export function TrendWindow() {
  const [shown, setShown] = useState<Window>('hour')

  return (
    <div className={styles.window}>
      <Caption>Trends</Caption>

      <Choices
        name="Trend window"
        choices={[
          { value: 'hour', label: 'Last hour' },
          { value: 'run', label: 'Whole run' },
        ]}
        chosen={shown}
        onChoose={setShown}
      />
    </div>
  )
}
