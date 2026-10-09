import { z } from 'zod'

const uuid = z.uuid()

const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/)

const name = z.string().min(1).max(256)

const jsonObject = z.record(z.string(), z.json())

const digest = z.string().regex(/^[a-f0-9]{64}$/)

function noControlCharacters(value: string): boolean {
  return Array.from(value).every(character => {
    const code = character.charCodeAt(0)

    return code >= 32 && (code < 127 || code > 159)
  })
}

export type CriaValue = z.infer<ReturnType<typeof z.json>>

export const CriaDeviceKindSchema = z.enum(['camera', 'mount', 'focuser', 'weather', 'switch'])

export type CriaDeviceKind = z.infer<typeof CriaDeviceKindSchema>

export const CriaDeviceBindingSchema = z.strictObject({
  id: identifier,
  kind: CriaDeviceKindSchema,
  expectedName: name,
})

export type CriaDeviceBinding = z.infer<typeof CriaDeviceBindingSchema>

export const CriaClientConfigSchema = z.strictObject({
  baseUrl: z.url().refine(value => {
    const url = new URL(value)

    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
      !url.search && !url.hash && url.pathname === '/'
  }, 'Cria endpoint must be an HTTP(S) origin without credentials, query, or fragment'),
  token: z.string().min(32).refine(noControlCharacters),
  storeId: uuid,
  devices: z.array(CriaDeviceBindingSchema).min(1).max(16)
    .refine(devices => new Set(devices.map(device => device.id)).size === devices.length,
      'Cria device IDs must be unique'),
})

export type CriaClientConfig = z.infer<typeof CriaClientConfigSchema>

const positiveSetting = z.number().int().min(1).max(1_000_000)

const nonnegativeSetting = z.number().int().min(0).max(1_000_000)

const focuserPosition = z.number().int().min(1).max(2_147_483_646)

const axisRate = z.number().min(-10).max(10).refine(value => value !== 0)

const empty = z.strictObject({})

export const CriaCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('capture'),
    parameters: z.strictObject({
      exposureSeconds: z.number().min(0.000001).max(3600),
      light: z.boolean(),
      monochromeOnly: z.boolean().optional(),
    }),
  }),
  z.strictObject({
    kind: z.literal('camera-configure'),
    parameters: z.strictObject({
      binX: positiveSetting.optional(),
      binY: positiveSetting.optional(),
      startX: nonnegativeSetting.optional(),
      startY: nonnegativeSetting.optional(),
      width: positiveSetting.optional(),
      height: positiveSetting.optional(),
      gain: nonnegativeSetting.optional(),
      offset: nonnegativeSetting.optional(),
    }).refine(parameters => Object.values(parameters).some(value => value !== undefined)),
  }),
  z.strictObject({
    kind: z.literal('cooling'),
    parameters: z.strictObject({
      coolerOn: z.boolean().optional(),
      setpointC: z.number().min(-100).max(100).optional(),
    }).refine(parameters => parameters.coolerOn !== undefined || parameters.setpointC !== undefined),
  }),
  z.strictObject({
    kind: z.literal('focuser-move'),
    parameters: z.strictObject({
      position: focuserPosition,
      minPosition: focuserPosition,
      maxPosition: focuserPosition,
    }).refine(parameters => parameters.position >= parameters.minPosition &&
      parameters.position <= parameters.maxPosition),
  }),
  z.strictObject({
    kind: z.literal('mount-slew'),
    parameters: z.strictObject({
      rightAscensionDegrees: z.number().min(0).max(359.999999999),
      declinationDegrees: z.number().min(-90).max(90),
      coordinateSystem: z.enum(['topocentric', 'j2000', 'j2050', 'b1950']),
    }),
  }),
  z.strictObject({
    kind: z.literal('mount-tracking'),
    parameters: z.strictObject({ tracking: z.boolean() }),
  }),
  z.strictObject({
    kind: z.literal('mount-axis'),
    parameters: z.strictObject({
      rateDegreesPerSecond: axisRate,
      durationSeconds: z.number().min(0.001).max(120),
    }),
  }),
  z.strictObject({
    kind: z.literal('mount-rotate'),
    parameters: z.strictObject({
      rateDegreesPerSecond: axisRate,
      distanceDegrees: z.number().min(-120).max(120).refine(value => value !== 0),
    }),
  }),
  z.strictObject({
    kind: z.literal('switch-set'),
    parameters: z.strictObject({
      channelId: z.number().int().min(0).max(63),
      value: z.number().min(-1e12).max(1e12),
    }),
  }),
  z.strictObject({
    kind: z.literal('device-connect'),
    parameters: z.strictObject({ connected: z.boolean() }),
  }),
  z.strictObject({ kind: z.literal('focuser-halt'), parameters: empty }),
  z.strictObject({ kind: z.literal('mount-home'), parameters: empty }),
  z.strictObject({ kind: z.literal('mount-stop'), parameters: empty }),
  z.strictObject({ kind: z.literal('mount-park'), parameters: empty }),
  z.strictObject({ kind: z.literal('mount-unpark'), parameters: empty }),
])

export type CriaCommand = z.infer<typeof CriaCommandSchema>

const operationIdentity = {
  instanceId: uuid,
  requestId: z.string().min(1).max(128).refine(noControlCharacters),
  deviceId: identifier,
  bindingId: uuid,
  expectedName: name,
}

export const CriaOperationRequestSchema = z.strictObject({
  ...operationIdentity,
  kind: z.string(),
  parameters: jsonObject,
}).refine(request => CriaCommandSchema.safeParse({
  kind: request.kind,
  parameters: request.parameters,
}).success, 'Invalid operation parameters')

export type CriaOperationRequest = CriaCommand & z.infer<z.ZodObject<typeof operationIdentity>>

export const CriaReadingSchema = z.strictObject({
  value: z.json(),
  observedAt: timestamp.nullable(),
  checkedAt: timestamp.nullable(),
  readStartedAt: timestamp.nullable(),
  generation: z.number().int().nullable(),
  status: z.enum(['pending', 'current', 'unsupported', 'error', 'stale']),
  message: z.string().nullable(),
})

export type CriaReading = z.infer<typeof CriaReadingSchema>

export const CriaImageSchema = z.strictObject({
  id: uuid,
  operationId: uuid,
  instanceId: uuid,
  deviceId: identifier,
  cameraName: name,
  bindingId: uuid,
  width: z.number().int().min(1).max(100_000_000),
  height: z.number().int().min(1).max(100_000_000),
  binX: z.number().int().positive(),
  binY: z.number().int().positive(),
  startX: z.number().int().nonnegative(),
  startY: z.number().int().nonnegative(),
  exposureSeconds: z.number().positive().max(3600),
  color: z.enum(['mono', 'rggb', 'grbg', 'gbrg', 'bggr']),
  capturedAt: timestamp,
  capturedAtSource: z.enum(['camera', 'server-estimate']),
  retainedAt: timestamp,
  sha256: digest,
  original: z.strictObject({
    mediaType: z.literal('application/imagebytes'),
    bytes: z.number().int().min(44).max(400_000_044),
    url: z.string(),
  }),
  preview: z.null(),
}).refine(image => image.width * image.height <= 100_000_000 &&
  image.original.url === `/v2/images/${image.id}/original`, 'Invalid retained image bounds or URL')

export type CriaImage = z.infer<typeof CriaImageSchema>

/** Exact-byte archive attestation; Cria checks its own identities and digest before accepting it. */
export const CriaArchiveReceiptSchema = z.strictObject({
  receiptId: uuid,
  storeId: uuid,
  imageId: uuid,
  operationId: uuid,
  sha256: digest,
  bytes: z.number().int().min(44),
  archive: z.strictObject({
    system: z.string().min(1).max(64),
    artifactId: z.string().min(1).max(256),
    representation: z.literal('imagebytes'),
    sha256: digest,
    bytes: z.number().int().min(44),
    contextSha256: digest,
    verification: z.strictObject({ method: z.string().min(1).max(64), verifiedAt: timestamp }),
  }),
})

export type CriaArchiveReceipt = z.infer<typeof CriaArchiveReceiptSchema>

export const CriaCustodyStateSchema = z.enum([
  'reserved', 'retained', 'quarantined', 'absent', 'archived', 'released', 'missing', 'legacy-removed',
])

export type CriaCustodyState = z.infer<typeof CriaCustodyStateSchema>

/** Cria's durable record for one reserved image, readable whatever its operation outcome. */
export const CriaCustodySchema = z.strictObject({
  id: uuid,
  storeId: uuid,
  operationId: z.string(),
  requestId: z.string(),
  instanceId: z.string(),
  deviceId: z.string(),
  bindingId: z.string(),
  cameraName: z.string(),
  state: CriaCustodyStateSchema,
  reservedAt: timestamp,
  updatedAt: timestamp,
  reason: z.string().nullable(),
  context: jsonObject,
  image: CriaImageSchema.nullable(),
  discovery: z.enum(['operation-result', 'worker-completion', 'migration']).nullable(),
  candidate: z.strictObject({ path: z.string(), bytes: z.number().int().nonnegative() }).nullable(),
  receipt: CriaArchiveReceiptSchema.nullable(),
  receiptFingerprint: digest.nullable(),
  receiptAcceptedAt: timestamp.nullable(),
  releasedAt: timestamp.nullable(),
  history: z.array(z.strictObject({ at: timestamp, state: CriaCustodyStateSchema, note: z.string() })),
}).refine(record => !['retained', 'archived'].includes(record.state) ||
  record.image?.id === record.id && record.image.operationId === record.operationId,
'Retained custody must describe its own original')

export type CriaCustody = z.infer<typeof CriaCustodySchema>

export const CriaCustodyPageSchema = z.strictObject({
  storeId: uuid,
  images: z.array(CriaCustodySchema).max(500),
  next: z.number().int().nonnegative(),
})

const byteCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

const recordTally = z.strictObject({ records: byteCount, bytes: byteCount })

/**
 * Cria's local custody capacity from `GET /v2/storage`. Read-only bookkeeping: reading it never
 * contacts a driver. `states` counts outstanding records; `missing` and terminal states are not
 * included and must be listed separately.
 */
export const CriaStorageSchema = z.strictObject({
  operations: z.strictObject({
    storeId: uuid,
    requests: byteCount,
    requestLimit: byteCount,
    retainedOperationLimit: byteCount,
    durable: z.boolean(),
  }),
  images: z.strictObject({
    retention: z.literal('until-archive-receipt'),
    releaseArchivedOriginals: z.boolean(),
    imageRetentionSecondsIgnored: z.boolean(),
    committedBytes: byteCount,
    budgetBytes: byteCount,
    /** Bytes held for each admitted capture until its original is measured. */
    reservationBytes: byteCount,
    /** Free space of the volume holding Cria's image store. */
    freeBytes: byteCount,
    freeSpaceReserveBytes: byteCount,
    outstandingRecords: byteCount,
    recordLimit: byteCount,
    states: z.strictObject({
      reserved: recordTally,
      retained: recordTally,
      quarantined: recordTally,
      archived: recordTally,
    }),
    downloads: byteCount,
    captureAdmissible: z.boolean(),
    refusal: z.string().nullable(),
    migration: jsonObject.nullable(),
  }),
})

export type CriaStorage = z.infer<typeof CriaStorageSchema>

export const CriaOperationSchema = z.strictObject({
  id: uuid,
  ...operationIdentity,
  failureDomain: identifier,
  kind: z.enum([
    'capture', 'camera-configure', 'cooling', 'focuser-move', 'focuser-halt',
    'mount-slew', 'mount-home', 'mount-stop', 'mount-tracking', 'mount-park',
    'mount-unpark', 'mount-axis', 'mount-rotate', 'switch-set', 'device-connect',
  ]),
  parameters: jsonObject,
  acceptedAt: timestamp,
  startedAt: timestamp.nullable(),
  elapsedSeconds: z.number().nonnegative().nullable(),
  completedAt: timestamp.nullable(),
  status: z.enum(['accepted', 'running', 'succeeded', 'failed', 'cancelled', 'uncertain']),
  phase: z.string(),
  acknowledged: z.boolean(),
  cancelRequested: z.boolean(),
  blocksDevice: z.boolean(),
  settled: z.boolean(),
  observation: z.enum(['current', 'retrying']),
  message: z.string().nullable(),
  result: jsonObject,
  reservedImageId: uuid.nullable(),
  image: CriaImageSchema.nullable(),
  reconciliation: z.strictObject({
    at: timestamp,
    note: z.string(),
    externalRecoveryConfirmed: z.literal(true),
  }).nullable(),
}).refine(operation => CriaCommandSchema.safeParse({
  kind: operation.kind,
  parameters: operation.parameters,
}).success, 'Invalid operation parameters')

export type CriaOperation = z.infer<typeof CriaOperationSchema>

export const CriaDeviceSchema = z.strictObject({
  id: identifier,
  kind: CriaDeviceKindSchema,
  bindingId: uuid,
  expectedName: name,
  failureDomain: identifier,
  health: z.enum(['starting', 'ready', 'refreshing', 'degraded', 'disconnected', 'unavailable']),
  blocked: z.boolean(),
  reason: z.string().nullable(),
  observationGeneration: z.number().int().nonnegative(),
  refreshPending: z.boolean(),
  fields: z.record(z.string(), CriaReadingSchema),
  channels: z.array(z.record(z.string(), CriaReadingSchema)).max(64),
  commandReady: z.boolean(),
})

export type CriaDevice = z.infer<typeof CriaDeviceSchema>

export const CriaStateSchema = z.strictObject({
  /** 3: originals stay in Cria custody until an accepted archive receipt. */
  protocolVersion: z.literal(3),
  instanceId: uuid,
  storeId: uuid,
  sequence: z.number().int().nonnegative(),
  generatedAt: timestamp,
  commandsEnabled: z.boolean(),
  /** Set once an essential Cria storage write failed; admission stays stopped until restart. */
  admissionStoppedReason: z.string().nullable(),
  devices: z.array(CriaDeviceSchema).max(16),
  operations: z.array(CriaOperationSchema),
}).refine(state => new Set(state.devices.map(device => device.id)).size === state.devices.length,
  'Duplicate Cria device IDs')

export type CriaState = z.infer<typeof CriaStateSchema>

export const CriaErrorSchema = z.strictObject({
  error: z.strictObject({ code: z.string(), message: z.string() }),
  instanceId: uuid.nullable().optional(),
})

export const CriaRefreshSchema = z.strictObject({
  deviceId: identifier,
  generation: z.number().int().nonnegative(),
  pending: z.literal(true),
})
