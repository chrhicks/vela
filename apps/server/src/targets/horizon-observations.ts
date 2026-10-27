import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { isMissingFile, writePrivateFile } from './private-file.js'

const rigIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

/** Where the mount pointed when the stars dropped out of a light run. */
export const observationSchema = z.strictObject({
  id: z.string().min(1),
  at: z.string().refine(value => Number.isFinite(Date.parse(value))),
  altitudeDegrees: z.number().min(0).max(90),
  azimuthDegrees: z.number().min(0).lt(360),
  /** The run's baseline of strong stars before the drop. */
  strongBefore: z.number().int().min(0),
  /** The strong stars of the frame where the collapse began. */
  strongAt: z.number().int().min(0),
  runId: z.string().min(1),
})

const observationsFileSchema = z.strictObject({
  version: z.literal(1),
  observations: z.array(observationSchema),
})

export type Observation = z.infer<typeof observationSchema>

export type NewObservation = Omit<Observation, 'id'>

export function observationsFilePath(directory: string, rigId: string): string | null {
  return rigIdPattern.test(rigId) ? join(directory, `horizon-observations-${rigId}.json`) : null
}

export interface ObservationStore {
  /** Oldest first. Empty when the rig has none, or its file cannot be used. */
  list(rigId: string): Promise<Observation[]>
  /** Like `list`, and says whether the file exists but cannot be used. */
  read(rigId: string): Promise<{ observations: Observation[]; unreadable: boolean }>
  /** Throws when the rig id has no file or the existing file is unusable: a file is never overwritten blind. */
  add(rigId: string, observation: NewObservation): Promise<Observation>
  /** False when no such observation exists. */
  remove(rigId: string, id: string): Promise<boolean>
}

type Read = { state: 'ok'; observations: Observation[] } | { state: 'unusable' }

/**
 * Reads on every call, like the profile. Changes to a rig's file run one at a time, so a delete and a
 * record never overwrite each other. An unusable file warns once per process, without values.
 */
export function createObservationStore(
  directory: string,
  warn: (message: string) => void = message => console.warn(message),
): ObservationStore {
  const warned = new Set<string>()
  const queues = new Map<string, Promise<unknown>>()

  function unusable(rigId: string, reason: string): Read {
    const message = `Ignoring the horizon observations for rig ${rigId}: ${reason}.`

    if (!warned.has(message)) {
      warned.add(message)
      warn(message)
    }

    return { state: 'unusable' }
  }

  async function read(rigId: string, path: string): Promise<Read> {
    let text: string

    try {
      text = await readFile(path, 'utf8')
    } catch (error) {
      return isMissingFile(error) ? { state: 'ok', observations: [] } : unusable(rigId, 'it could not be read')
    }

    try {
      return { state: 'ok', observations: observationsFileSchema.parse(JSON.parse(text)).observations }
    } catch {
      return unusable(rigId, 'it is not a valid observations file')
    }
  }

  function write(path: string, observations: Observation[]) {
    return writePrivateFile(
      path,
      `${JSON.stringify(observationsFileSchema.parse({ version: 1, observations }))}\n`,
    )
  }

  function inOrder<T>(rigId: string, change: () => Promise<T>): Promise<T> {
    const result = (queues.get(rigId) ?? Promise.resolve()).then(change)

    queues.set(rigId, result.catch(() => undefined))

    return result
  }

  /** The file and what it holds, for a change that writes it back. */
  async function forChange(rigId: string) {
    const path = observationsFilePath(directory, rigId)

    if (!path) throw new Error('This rig id has no horizon observations file.')

    const current = await read(rigId, path)

    if (current.state === 'unusable') throw new Error('The horizon observations file is unusable and is left as it is.')

    return { path, observations: current.observations }
  }

  async function readState(rigId: string) {
    const path = observationsFilePath(directory, rigId)

    if (!path) return { observations: [], unreadable: false }

    const current = await read(rigId, path)

    return current.state === 'ok'
      ? { observations: current.observations, unreadable: false }
      : { observations: [], unreadable: true }
  }

  return {
    read: readState,

    list: async rigId => (await readState(rigId)).observations,

    add: (rigId, observation) =>
      inOrder(rigId, async () => {
        const { path, observations } = await forChange(rigId)
        const added = { id: randomUUID(), ...observation }

        await write(path, [...observations, added])

        return added
      }),

    remove: (rigId, id) =>
      inOrder(rigId, async () => {
        const { path, observations } = await forChange(rigId)
        const remaining = observations.filter(observation => observation.id !== id)

        if (remaining.length === observations.length) return false

        await write(path, remaining)

        return true
      }),
  }
}
