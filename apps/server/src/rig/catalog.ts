import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { parse, stringify } from 'yaml'
import { z } from 'zod'
import type { RigEndpoint, RigId } from '@vela/model/rig'
import type {
  ObservedRigInventory,
  RigCandidateMatch,
  RigCatalogRecord,
} from './contracts.js'

export interface AddRigInput {
  readonly name: string
  readonly endpoint: RigEndpoint
  readonly inventory: ObservedRigInventory
}

export type AddRigResult =
  | { readonly state: 'added'; readonly rig: RigCatalogRecord }
  | { readonly state: 'known'; readonly rigId: RigId }
  | { readonly state: 'conflict'; readonly rigIds: ReadonlyArray<RigId> }

export interface RigCatalog {
  list(): Promise<ReadonlyArray<RigCatalogRecord>>
  get(rigId: RigId): Promise<RigCatalogRecord | undefined>
  observe(
    endpoint: RigEndpoint,
    inventory: ObservedRigInventory,
  ): Promise<RigCandidateMatch>
  add(input: AddRigInput): Promise<AddRigResult>
  setImagingCamera(
    rigId: RigId,
    camera: NonNullable<RigCatalogRecord['imagingCamera']>,
  ): Promise<boolean>
  setFocalLength(rigId: RigId, focalLengthMm: number): Promise<boolean>
  forget(rigId: RigId): Promise<boolean>
}

interface RigCatalogOptions {
  readonly createId?: () => RigId
  readonly now?: () => Date
}

type SaveCatalog = (records: ReadonlyArray<RigCatalogRecord>) => Promise<void>

const nonEmptyString = z.string().refine(value => value.trim().length > 0)

const canonicalString = nonEmptyString.refine(value => value === value.trim())

const isoDateTime = z.string().refine(value => {
  const date = new Date(value)

  return !Number.isNaN(date.getTime()) && date.toISOString() === value
})

const inventorySchema = z.strictObject({
  observedAt: isoDateTime,
  devices: z.array(z.strictObject({
    uniqueId: canonicalString,
    kind: z.enum([
      'camera',
      'cover-calibrator',
      'dome',
      'filter-wheel',
      'focuser',
      'observing-conditions',
      'rotator',
      'safety-monitor',
      'switch',
      'telescope',
      'unknown',
    ]),
    name: nonEmptyString,
  })).refine(
    devices => new Set(devices.map(device => device.uniqueId)).size === devices.length,
    'Device IDs must be unique within a Rig',
  ),
})

const rigSchema = z.strictObject({
  id: canonicalString,
  name: nonEmptyString,
  endpoint: z.strictObject({ host: canonicalString, port: z.number().int().min(1).max(65535) }),
  addedAt: isoDateTime,
  imagingCamera: z.strictObject({ uniqueId: canonicalString, name: nonEmptyString }).optional(),
  focalLengthMm: z.number().min(10).max(20000).optional(),
  lastObservedInventory: inventorySchema,
}).transform(({ imagingCamera, focalLengthMm, ...required }): RigCatalogRecord => {
  let rig: RigCatalogRecord = required

  if (imagingCamera !== undefined) rig = { ...rig, imagingCamera }

  if (focalLengthMm !== undefined) rig = { ...rig, focalLengthMm }

  return rig
})

const catalogSchema = z.strictObject({
  rigs: z.array(rigSchema).refine(
    rigs => new Set(rigs.map(rig => rig.id)).size === rigs.length,
    'Rig IDs must be unique',
  ),
})

export class InvalidRigInventoryError extends Error {
  constructor(options?: ErrorOptions) {
    super('The observed Rig inventory is invalid', options)
    this.name = 'InvalidRigInventoryError'
  }
}

export class RigCatalogFileError extends Error {
  constructor(
    message: string,
    readonly path: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'RigCatalogFileError'
  }
}

export function createMemoryRigCatalog(
  initialRecords: ReadonlyArray<RigCatalogRecord> = [],
  options: RigCatalogOptions = {},
): RigCatalog {
  return createRigCatalog(initialRecords, async () => {}, options)
}

export async function openFileRigCatalog(
  path: string,
  options: RigCatalogOptions = {},
): Promise<RigCatalog> {
  const initialRecords = await readCatalogFile(path)

  return createRigCatalog(
    initialRecords,
    (records) => writeCatalogFile(path, records),
    options,
  )
}

function createRigCatalog(
  initialRecords: ReadonlyArray<RigCatalogRecord>,
  save: SaveCatalog,
  {
    createId = randomUUID,
    now = () => new Date(),
  }: RigCatalogOptions,
): RigCatalog {
  let records = copyRecords(initialRecords)
  let pendingChange = Promise.resolve()

  function change<T>(operation: () => Promise<T>): Promise<T> {
    const result = pendingChange.then(operation, operation)
    pendingChange = result.then(() => undefined, () => undefined)

    return result
  }

  async function replace(nextRecords: ReadonlyArray<RigCatalogRecord>) {
    await save(nextRecords)
    records = copyRecords(nextRecords)
  }

  return {
    async list() {
      await pendingChange

      return copyRecords(records)
    },

    async get(rigId) {
      await pendingChange
      const record = records.find((candidate) => candidate.id === rigId)

      return record === undefined ? undefined : copyRecord(record)
    },

    observe(endpoint, inventory) {
      return change(async () => {
        const checkedInventory = validateObservedInventory(inventory)
        const match = matchRigCandidate(records, endpoint, checkedInventory)

        if (match.state !== 'known') return match

        const nextRecords = records.map((record) => record.id === match.rigId
          ? {
              ...record,
              endpoint: { ...endpoint },
              lastObservedInventory: checkedInventory,
            }
          : record)

        await replace(nextRecords)

        return match
      })
    },

    add(input) {
      return change(async () => {
        const checkedInventory = validateObservedInventory(input.inventory)
        const match = matchRigCandidate(records, input.endpoint, checkedInventory)

        if (match.state === 'known') {
          const nextRecords = records.map((record) => record.id === match.rigId
            ? {
                ...record,
                endpoint: { ...input.endpoint },
                lastObservedInventory: checkedInventory,
              }
            : record)

          await replace(nextRecords)

          return { state: 'known', rigId: match.rigId }
        }

        if (match.state === 'conflict') return match

        const rig: RigCatalogRecord = {
          id: createId(),
          name: input.name.trim(),
          endpoint: { ...input.endpoint },
          addedAt: now().toISOString(),
          lastObservedInventory: checkedInventory,
        }

        await replace([...records, rig])

        return { state: 'added', rig: copyRecord(rig) }
      })
    },

    setImagingCamera(rigId, camera) {
      return change(async () => {
        if (!canonicalString.safeParse(camera.uniqueId).success || !nonEmptyString.safeParse(camera.name).success)
          throw new Error('Invalid imaging camera')

        if (!records.some(record => record.id === rigId)) return false
        await replace(records.map(record => record.id === rigId
          ? { ...record, imagingCamera: { ...camera } }
          : record,
        ))

        return true
      })
    },

    setFocalLength(rigId, focalLengthMm) {
      return change(async () => {
        if (!Number.isFinite(focalLengthMm) || focalLengthMm < 10 || focalLengthMm > 20000)
          throw new Error('Invalid focal length')

        if (!records.some(record => record.id === rigId)) return false
        await replace(records.map(record => record.id === rigId ? { ...record, focalLengthMm } : record))

        return true
      })
    },

    forget(rigId) {
      return change(async () => {
        const nextRecords = records.filter((record) => record.id !== rigId)

        if (nextRecords.length === records.length) return false

        await replace(nextRecords)

        return true
      })
    },
  }
}

export function matchRigCandidate(
  records: ReadonlyArray<RigCatalogRecord>,
  endpoint: RigEndpoint,
  inventory: ObservedRigInventory,
): RigCandidateMatch {
  const candidateDeviceIds = new Set(
    inventory.devices.map((device) => device.uniqueId),
  )

  const matchingRigs = records.filter((record) =>
    endpointsEqual(record.endpoint, endpoint)
      || record.lastObservedInventory.devices.some((device) =>
        candidateDeviceIds.has(device.uniqueId),
      ),
  )

  if (matchingRigs.length === 0) return { state: 'new' }

  if (matchingRigs.length > 1) {
    return {
      state: 'conflict',
      rigIds: matchingRigs.map((rig) => rig.id),
    }
  }

  const rig = matchingRigs[0]!

  return {
    state: 'known',
    rigId: rig.id,
    endpointChanged: !endpointsEqual(rig.endpoint, endpoint),
    inventoryChanged: !inventoriesEqual(rig.lastObservedInventory, inventory),
  }
}

function endpointsEqual(left: RigEndpoint, right: RigEndpoint): boolean {
  return left.host === right.host && left.port === right.port
}

function inventoriesEqual(
  left: ObservedRigInventory,
  right: ObservedRigInventory,
): boolean {
  if (left.devices.length !== right.devices.length) return false

  const rightDevices = new Map(
    right.devices.map((device) => [device.uniqueId, device]),
  )

  return left.devices.every((device) => {
    const other = rightDevices.get(device.uniqueId)

    return other?.kind === device.kind && other.name === device.name
  })
}

async function readCatalogFile(path: string): Promise<ReadonlyArray<RigCatalogRecord>> {
  let contents: string

  try {
    contents = await readFile(path, 'utf8')
  } catch (error) {
    if (isFileError(error) && error.code === 'ENOENT') return []
    throw new RigCatalogFileError('Could not read the Rig catalog', path, { cause: error })
  }

  try {
    return catalogSchema.parse(parse(contents)).rigs
  } catch (error) {
    throw new RigCatalogFileError('The Rig catalog is invalid', path, { cause: error })
  }
}

async function writeCatalogFile(
  path: string,
  records: ReadonlyArray<RigCatalogRecord>,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`

  try {
    await writeFile(
      temporaryPath,
      stringify({ rigs: records }, { lineWidth: 0 }),
      { encoding: 'utf8', mode: 0o600 },
    )
    await rename(temporaryPath, path)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {})
    throw new RigCatalogFileError('Could not write the Rig catalog', path, { cause: error })
  }
}

function validateObservedInventory(value: ObservedRigInventory): ObservedRigInventory {
  try {
    return inventorySchema.parse(value)
  } catch (cause) {
    throw new InvalidRigInventoryError({ cause })
  }
}

function copyRecords(
  records: ReadonlyArray<RigCatalogRecord>,
): ReadonlyArray<RigCatalogRecord> {
  return records.map(copyRecord)
}

function copyRecord(record: RigCatalogRecord): RigCatalogRecord {
  const copy: RigCatalogRecord = {
    ...record,
    endpoint: { ...record.endpoint },
    lastObservedInventory: copyInventory(record.lastObservedInventory),
  }

  if (record.imagingCamera) return { ...copy, imagingCamera: { ...record.imagingCamera } }

  return copy
}

function copyInventory(inventory: ObservedRigInventory): ObservedRigInventory {
  return {
    observedAt: inventory.observedAt,
    devices: inventory.devices.map((device) => ({ ...device })),
  }
}

function isFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
