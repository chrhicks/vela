import { createRoot, type Root } from 'react-dom/client'
import { useAutofocus } from '../src/features/autofocus/use-autofocus'

let controller: ReturnType<typeof useAutofocus> | undefined

let root: Root | undefined

function AutofocusHookHarness() {
  controller = useAutofocus('rig-1')

  return null
}

export function mountAutofocusHook() {
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  root.render(<AutofocusHookHarness />)
}

export function getAutofocusHook() {
  if (!controller) throw new Error('Autofocus hook has not rendered')

  return controller
}

export function unmountAutofocusHook() {
  root?.unmount()
  controller = undefined
}
