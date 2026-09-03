import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { parse, stringify } from 'yaml'
import type { DeviceKind } from '@vela/model/device'
import type { RigEndpoint, RigId } from '@vela/model/rig'
import type {
  ObservedDeviceRecord,
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
  forget(rigId: RigId): Promise<boolean>
}

interface RigCatalogOptions {
  readonly createId?: () => RigId
  readonly now?: () => Date
}

type SaveCatalog = (records: ReadonlyArray<RigCatalogRecord>) => Promise<void>

const deviceKinds: ReadonlySet<DeviceKind> = new Set([
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
])

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
    return parseCatalog(parse(contents))
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

function parseCatalog(value: unknown): ReadonlyArray<RigCatalogRecord> {
  if (!isRecord(value) || !hasOnlyKeys(value, ['rigs']) || !Array.isArray(value.rigs)) {
    throw new Error('Expected a rigs array')
  }

  const records = value.rigs.map(parseRigRecord)
  if (new Set(records.map((record) => record.id)).size !== records.length) {
    throw new Error('Rig IDs must be unique')
  }
  return records
}

function parseRigRecord(value: unknown): RigCatalogRecord {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'id',
    'name',
    'endpoint',
    'addedAt',
    'lastObservedInventory',
  ])) {
    throw new Error('Invalid Rig record')
  }

  if (!isCanonicalNonEmptyString(value.id) || !isNonEmptyString(value.name)) {
    throw new Error('Rig id and name are required')
  }
  if (!isIsoDateTime(value.addedAt)) throw new Error('Invalid addedAt timestamp')

  return {
    id: value.id,
    name: value.name,
    endpoint: parseEndpoint(value.endpoint),
    addedAt: value.addedAt,
    lastObservedInventory: parseInventory(value.lastObservedInventory),
  }
}

function parseEndpoint(value: unknown): RigEndpoint {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, ['host', 'port'])
    || !isCanonicalNonEmptyString(value.host)
    || !Number.isInteger(value.port)
    || Number(value.port) < 1
    || Number(value.port) > 65535
  ) {
    throw new Error('Invalid Rig endpoint')
  }
  return { host: value.host, port: Number(value.port) }
}

function validateObservedInventory(value: unknown): ObservedRigInventory {
  try {
    return parseInventory(value)
  } catch (cause) {
    throw new InvalidRigInventoryError({ cause })
  }
}

function parseInventory(value: unknown): ObservedRigInventory {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, ['observedAt', 'devices'])
    || !isIsoDateTime(value.observedAt)
    || !Array.isArray(value.devices)
  ) {
    throw new Error('Invalid observed inventory')
  }

  const devices = value.devices.map(parseDevice)
  if (new Set(devices.map((device) => device.uniqueId)).size !== devices.length) {
    throw new Error('Device IDs must be unique within a Rig')
  }
  return { observedAt: value.observedAt, devices }
}

function parseDevice(value: unknown): ObservedDeviceRecord {
  if (
    !isRecord(value)
    || !hasOnlyKeys(value, ['uniqueId', 'kind', 'name'])
    || !isCanonicalNonEmptyString(value.uniqueId)
    || !deviceKinds.has(value.kind as DeviceKind)
    || !isNonEmptyString(value.name)
  ) {
    throw new Error('Invalid observed device')
  }

  return {
    uniqueId: value.uniqueId,
    kind: value.kind as DeviceKind,
    name: value.name,
  }
}

function copyRecords(
  records: ReadonlyArray<RigCatalogRecord>,
): ReadonlyArray<RigCatalogRecord> {
  return records.map(copyRecord)
}

function copyRecord(record: RigCatalogRecord): RigCatalogRecord {
  return {
    ...record,
    endpoint: { ...record.endpoint },
    lastObservedInventory: copyInventory(record.lastObservedInventory),
  }
}

function copyInventory(inventory: ObservedRigInventory): ObservedRigInventory {
  return {
    observedAt: inventory.observedAt,
    devices: inventory.devices.map((device) => ({ ...device })),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: ReadonlyArray<string>): boolean {
  const expected = new Set(keys)
  return Object.keys(value).every((key) => expected.has(key))
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isCanonicalNonEmptyString(value: unknown): value is string {
  return isNonEmptyString(value) && value === value.trim()
}

function isIsoDateTime(value: unknown): value is string {
  if (typeof value !== 'string') return false

  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && date.toISOString() === value
}

function isFileError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
