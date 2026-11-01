import { readFile, readdir, stat } from 'node:fs/promises'
import { epochMs } from '@vela/rig-events'

export const run = [readFile, readdir, stat, epochMs]
