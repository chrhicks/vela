import { Cause, Exit, Schema } from 'effect'
import { CriaExchangeBody, CriaImageBody, CriaStreamBody } from './bodies.ts'
import { decodeEvent, seal, type DecodeResult } from './codec.ts'
import type { RigEvent } from './event.ts'
import { EpochMs, type RigId, type SourceId } from './primitives.ts'
import { State } from './wire.ts'

const StateLine = Schema.Struct({
  kind: Schema.Literal('state'),
  at: EpochMs,
  origin: Schema.String,
  generatedAt: EpochMs,
  sequence: Schema.Int,
  instanceId: Schema.String,
  commandsEnabled: Schema.Boolean,
  baseline: Schema.Boolean,
  changed: Schema.Record(Schema.String, Schema.Json),
  removed: Schema.Array(Schema.String),
})

const JournalLine = Schema.Union([
  StateLine,
  Schema.Struct({ kind: Schema.Literal('exchange'), at: EpochMs, ...CriaExchangeBody.fields }),
  Schema.Struct({ kind: Schema.Literal('image'), at: EpochMs, ...CriaImageBody.fields }),
  Schema.Struct({ kind: Schema.Literal('stream'), at: EpochMs, ...CriaStreamBody.fields }),
])

type Cells = Map<string, Schema.Json>

interface DeviceCells {
  readonly fields: Record<string, Schema.Json>
  readonly readings: Record<string, Schema.Json>
}

const decodeLine = Schema.decodeUnknownExit(JournalLine)

const decodeState = Schema.decodeUnknownExit(State)

function describe(cause: Cause.Cause<unknown>): string {
  return Cause.pretty(cause).split('\n').slice(0, 3).join(' | ')
}

function devicesOf(cells: Cells): Record<string, Schema.Json>[] {
  const devices = new Map<string, DeviceCells>()
  const operations: Schema.Json[] = []

  for (const [key, cell] of cells) {
    const [scope, id, field] = key.split('/')

    if (scope === 'operation') {
      operations.push(cell)
      continue
    }

    if (scope !== 'device' || id === undefined || field === undefined) continue

    const device = devices.get(id) ?? { fields: { id }, readings: {} }
    devices.set(id, device)

    if (field.startsWith('readings.')) device.readings[field.slice('readings.'.length)] = cell
    else device.fields[field] = cell
  }

  return [...devices.values()].map(device => ({ ...device.fields, readings: device.readings }))
}

/**
 * Rebuilds snapshots from Vela's cell journal. A baseline (the first entry of a Vela process) replaces every
 * cell; later entries overlay what changed. The journal drops changes that are only a new `observedAt`, so a
 * rebuilt snapshot is `qualified`: it proves the stream was alive at `generatedAt`, not that a steady reading
 * was seen again then.
 */
export function createJournalImporter(context: { readonly rig: RigId; readonly source: SourceId }) {
  const cellsByOrigin = new Map<string, Cells>()

  function readState(line: typeof StateLine.Type): DecodeResult<RigEvent> {
    const known = cellsByOrigin.get(line.origin)

    if (!line.baseline && known === undefined)
      return { ok: false, error: `a delta for ${line.origin} arrived before any baseline`, raw: line }

    const cells: Cells = line.baseline || known === undefined ? new Map() : known
    cellsByOrigin.set(line.origin, cells)

    for (const [key, cell] of Object.entries(line.changed)) cells.set(key, cell)

    for (const key of line.removed) cells.delete(key)

    const operations = [...cells].flatMap(([key, cell]) => (key.startsWith('operation/') ? [cell] : []))

    const decoded = decodeState({
      protocolVersion: 5,
      instanceId: line.instanceId,
      sequence: line.sequence,
      generatedAt: line.generatedAt,
      commandsEnabled: line.commandsEnabled,
      devices: devicesOf(cells),
      operations,
    })

    if (!Exit.isSuccess(decoded)) return { ok: false, error: describe(decoded.cause), raw: line }

    return {
      ok: true,
      event: seal({
        kind: 'cria.state',
        rig: context.rig,
        source: context.source,
        at: line.generatedAt,
        seenAt: line.at,
        body: { origin: line.origin, freshness: 'qualified', state: decoded.value },
      }),
    }
  }

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This is the parse boundary: the schema decides what raw is.
  function readParsed(raw: unknown): DecodeResult<RigEvent> {
    const exit = decodeLine(raw)

    if (!Exit.isSuccess(exit)) return { ok: false, error: describe(exit.cause), raw }

    const line = exit.value
    const stamp = { rig: context.rig, source: context.source, at: line.at, seenAt: line.at } as const

    switch (line.kind) {
      case 'state':
        return readState(line)
      case 'exchange': {
        const { kind: _kind, at: _at, ...body } = line

        return { ok: true, event: seal({ ...stamp, kind: 'cria.exchange', body }) }
      }

      case 'image': {
        const { kind: _kind, at: _at, ...body } = line

        return { ok: true, event: seal({ ...stamp, kind: 'cria.image', body }) }
      }

      case 'stream': {
        const { kind: _kind, at: _at, ...body } = line

        return { ok: true, event: seal({ ...stamp, kind: 'cria.stream', body }) }
      }
    }
  }

  return {
    read(text: string): DecodeResult<RigEvent> {
      const parsed = parse(text)

      return parsed.ok ? readParsed(parsed.raw) : parsed
    },
    readParsed,
  }
}

function parse(text: string): { readonly ok: true; readonly raw: unknown } | { readonly ok: false; readonly error: string; readonly raw: string } {
  try {
    return { ok: true, raw: JSON.parse(text) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), raw: text }
  }
}

/**
 * Reads a line of either file Vela keeps of what its Cria client saw: a run-log envelope
 * (`docs/run-log.md`), decoded as it is, or a line of the cell journal that came before it, rebuilt
 * as `createJournalImporter` does. What the line is decides, so a caller reads old and new nights
 * with one reader. `context` stamps rebuilt journal lines; an envelope carries its own rig and source.
 */
export function createLogReader(context: { readonly rig: RigId; readonly source: SourceId }) {
  const journal = createJournalImporter(context)

  return {
    read(text: string): DecodeResult<RigEvent> {
      const parsed = parse(text)

      if (!parsed.ok) return parsed

      return isEnvelope(parsed.raw) ? decodeEvent(parsed.raw) : journal.readParsed(parsed.raw)
    },
  }
}

const isEnvelope = Schema.is(Schema.Struct({ v: Schema.Number }))
