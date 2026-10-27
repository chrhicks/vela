import { Dialog } from '@vela/ui'
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { RigControlsPanel } from './RigControlsPanel'
import './rig-controls.css'

const RigControlsContext = createContext<{ open(): void } | undefined>(undefined)

/** Owns whether the rig's Controls panel is open, so the header button and page links open the same one. */
export function RigControls({ rigId, children }: { rigId: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const openPanel = useCallback(() => setOpen(true), [])
  const value = useMemo(() => ({ open: openPanel }), [openPanel])

  return (
    <RigControlsContext value={value}>
      {children}
      <Dialog
        className="rig-controls"
        open={open}
        title="Controls"
        dismissLabel="Close controls"
        onDismiss={() => setOpen(false)}
      >
        <RigControlsPanel rigId={rigId} />
      </Dialog>
    </RigControlsContext>
  )
}

/** Undefined outside a rig page. */
export function useRigControls() {
  return useContext(RigControlsContext)
}
