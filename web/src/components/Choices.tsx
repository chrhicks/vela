import { ActionButton } from './ActionButton.tsx'
import styles from './Choices.module.css'

interface Choice<Value extends string> {
  readonly value: Value
  readonly label: string
}

interface ChoicesProps<Value extends string> {
  readonly name: string
  readonly choices: ReadonlyArray<Choice<Value>>
  readonly chosen: Value
  readonly onChoose: (value: Value) => void
}

export function Choices<Value extends string>({ name, choices, chosen, onChoose }: ChoicesProps<Value>) {
  return (
    <div className={styles.choices} role="group" aria-label={name}>
      {choices.map(choice => (
        <ActionButton key={choice.value} pressed={choice.value === chosen} onPress={() => onChoose(choice.value)}>
          {choice.label}
        </ActionButton>
      ))}
    </div>
  )
}
