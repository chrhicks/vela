import { readFileSync } from 'node:fs'
import { kinds } from '@vela/rig-events'

export const read = [readFileSync, kinds]
