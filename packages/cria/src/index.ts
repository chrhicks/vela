import { Schema } from 'effect'
import { MountEnvelope } from '@cria/wire'

export const parseMountEnvelope = Schema.decodeUnknownSync(MountEnvelope)

export type { MountEnvelope, AcceptedFix } from '@cria/wire'

export { createCriaConnection } from './connection.js'

export type { CriaConnection, CriaConnectionOptions } from './connection.js'

export { createCriaEquipment } from './equipment.js'

export type { CriaEquipmentBinding, CriaRecovery } from './equipment.js'

export type { JournalSink } from './v5/journal.js'
