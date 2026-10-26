import { parentPort } from 'node:worker_threads'
import { measureFrame } from './measure.ts'

const port = parentPort!

port.on('message', async (directory: string) => {
  port.postMessage(await measureFrame(directory))
})
