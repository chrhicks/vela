import type { FilterAnswer } from '../../../../state/commands.ts'
import { useRig } from '../../rig/store.ts'

export const useFilterAnswer = (): FilterAnswer | undefined => useRig(rig => rig.operations.filter)
