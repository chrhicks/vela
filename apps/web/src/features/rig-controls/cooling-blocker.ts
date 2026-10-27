import type { CaptureCoolingBlocker } from '@vela/model/web'

/** What currently holds the rig, and where Chris can resolve it. */
export function coolingBlocker(blockedBy: CaptureCoolingBlocker | undefined, rigPath: string) {
  switch (blockedBy) {
    case undefined:
      return null
    case 'alignment':
      return {
        message: 'Polar alignment is using the rig. Stop or finish alignment to change cooling.',
        action: { label: 'Open polar alignment', to: `${rigPath}/observe/alignment` },
      }
    case 'autofocus':
      return {
        message: 'Autofocus is using the rig. Cooling can change when it finishes.',
        action: { label: 'Open autofocus', to: `${rigPath}/observe/autofocus` },
      }
    case 'framing':
      return { message: 'Framing is using the rig. Cooling can change when it finishes.' }
    case 'capture':
      return { message: 'Cooling is locked while capture runs so Stop stays available.' }
    case 'rig':
      return { message: 'Another rig command is finishing. Cooling will be available when it does.' }
    default:
      return { message: blockedBy.reason }
  }
}

export type CoolingBlocker = ReturnType<typeof coolingBlocker>
