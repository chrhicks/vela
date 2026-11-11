import { useState } from 'react'

import { ActionButton } from '../../components/ActionButton.tsx'
import { Caption } from '../../components/Caption.tsx'
import styles from './TrendWindow.module.css'

type Window = 'hour' | 'run'

export function TrendWindow() {
  const [shown, setShown] = useState<Window>('hour')

  return (
    <div className={styles.window}>
      <Caption>Trends</Caption>

      <div className={styles.choices}>
        <ActionButton pressed={shown === 'hour'} onPress={() => setShown('hour')}>
          Last hour
        </ActionButton>

        <ActionButton pressed={shown === 'run'} onPress={() => setShown('run')}>
          Whole run
        </ActionButton>
      </div>
    </div>
  )
}
