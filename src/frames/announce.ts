import { readWireBody, type Entry } from '../../state/entry.ts'

export function announcesFrame(entry: Entry, camera: string) {
  if (entry.kind !== 'wire') return false

  const wire = readWireBody(entry.body)

  return wire !== undefined && wire.dir === 'in' && wire.device === camera && (wire.type === 'set' || wire.type === 'def') && wire.property === 'CCD_FILE_PATH' && typeof wire.elements['FILE_PATH'] === 'string' && wire.elements['FILE_PATH'] !== ''
}
