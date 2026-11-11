import { ActionButton } from '../../components/ActionButton.tsx'
import { ActionLink } from '../../components/ActionLink.tsx'
import { Alert } from '../../components/Alert.tsx'

interface ShutDownProps {
  readonly asking: boolean
  readonly onAsk: (asking: boolean) => void
}

export function ShutDown({ asking, onAsk }: ShutDownProps) {
  if (!asking) {
    return (
      <>
        <ActionButton quiet onPress={() => onAsk(true)}>
          Shut down rig PC
        </ActionButton>

        <ActionLink to="/?scene=capturing">Back to run</ActionLink>
      </>
    )
  }

  return (
    <Alert title="Shut down rig PC?" facts={['Ends the run', 'Power button is outside']}>
      <ActionLink to="/">Yes, shut down</ActionLink>

      <ActionButton quiet onPress={() => onAsk(false)}>
        Cancel
      </ActionButton>
    </Alert>
  )
}
