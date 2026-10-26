import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { readRetainedFits } from '@vela/server/imaging/read-retained-fits'
import { measureStars } from '@vela/server/imaging/statistics'

/** The two numbers Vela records for a frame, measured again, and what it cost. */
export type Measurement =
  | { status: 'measured'; detectedStars: number; medianHfrPixels: number | null; milliseconds: number }
  | { status: 'failed'; reason: string }

/** Vela's own capture measurement of one saved frame's `original.fits`. */
export async function measureFrame(directory: string): Promise<Measurement> {
  const started = performance.now()

  try {
    const frame = await readRetainedFits(await readFile(join(directory, 'original.fits')))
    const statistics = await measureStars(frame.width, frame.height, frame.pixels, frame.color)

    return { status: 'measured', ...statistics, milliseconds: performance.now() - started }
  } catch (error) {
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) }
  }
}

/** Measures every directory, in order. `jobs` above 1 spreads the frames over worker threads. */
export async function measureFrames(
  directories: string[],
  jobs: number,
  onMeasured: (done: number) => void = () => {},
): Promise<Measurement[]> {
  const results: Measurement[] = []
  let next = 0
  let done = 0

  const pull = async (measure: (directory: string) => Promise<Measurement>) => {
    while (next < directories.length) {
      const index = next++
      results[index] = await measure(directories[index]!)
      onMeasured(++done)
    }
  }

  if (jobs <= 1) {
    await pull(measureFrame)

    return results
  }

  const workers = Array.from({ length: Math.min(jobs, directories.length) }, async () => {
    const worker = new Worker(new URL('./measure-worker.ts', import.meta.url))

    try {
      await pull(directory => measureInWorker(worker, directory))
    } finally {
      await worker.terminate()
    }
  })

  await Promise.all(workers)

  return results
}

function measureInWorker(worker: Worker, directory: string) {
  return new Promise<Measurement>((resolve, reject) => {
    const failed = (error: Error) => {
      worker.off('message', measured)
      reject(error)
    }

    const measured = (measurement: Measurement) => {
      worker.off('error', failed)
      resolve(measurement)
    }

    worker.once('message', measured)
    worker.once('error', failed)
    worker.postMessage(directory)
  })
}
