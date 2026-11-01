import { spawn } from 'node:child_process'
import type { SolveBody } from '@vela/rig-events'

export const run = (body: SolveBody) => [spawn, body]
