/**
 * Link columns come in threes. `<name>_link` says how the target was found and is null when
 * nothing matched. The target column holds the match. `<name>_candidates` lists every
 * possibility when the link is ambiguous, and then the target stays null.
 */
export const linkKinds = ['exact', 'inferred', 'ambiguous'] as const

export type LinkKind = (typeof linkKinds)[number]

const sqlTypes = {
  text: 'VARCHAR',
  json: 'VARCHAR',
  link: 'VARCHAR',
  int: 'BIGINT',
  real: 'DOUBLE',
  bool: 'BOOLEAN',
  timestamp: 'TIMESTAMP',
} as const

interface ValueTypes {
  text: string
  json: string
  link: LinkKind
  int: number
  real: number
  bool: boolean
  timestamp: Date
}

type ColumnKind = keyof ValueTypes

interface Column<Kind extends ColumnKind, Nullable extends boolean> {
  readonly kind: Kind
  readonly nullable: Nullable
}

const required = <Kind extends ColumnKind>(kind: Kind): Column<Kind, false> => ({ kind, nullable: false })

const optional = <Kind extends ColumnKind>(kind: Kind): Column<Kind, true> => ({ kind, nullable: true })

type AnyColumn = Column<ColumnKind, boolean>

type TableSchema = Readonly<Record<string, AnyColumn>>

export type RowOf<Schema extends TableSchema> = {
  readonly [Name in keyof Schema]: Schema[Name] extends Column<infer Kind, infer Nullable>
    ? Nullable extends true
      ? ValueTypes[Kind] | null
      : ValueTypes[Kind]
    : never
}

export const tables = {
  frames: {
    session: required('text'),
    frame_id: required('text'),
    captured_at: required('timestamp'),
    captured_at_source: required('text'),
    received_at: required('timestamp'),
    exposure_seconds: required('real'),
    width: required('int'),
    height: required('int'),
    camera_name: required('text'),
    rig_id: required('text'),
    target_id: optional('text'),
    target_name: optional('text'),
    detected_stars: optional('int'),
    median_hfr_px: optional('real'),
    saved_dir: required('text'),
    span_id: optional('text'),
    span_link: optional('link'),
    span_candidates: optional('json'),
    run_frame_index: optional('int'),
    mount_sampled_at: optional('timestamp'),
    mount_link: optional('link'),
    mount_candidates: optional('json'),
    mount_age_seconds: optional('real'),
    run_id: optional('text'),
    attempt: optional('int'),
    request_id: optional('text'),
    operation_id: optional('text'),
    cria_image_id: optional('text'),
    attempt_link: optional('link'),
    attempt_candidates: optional('json'),
    operation_link: optional('link'),
    operation_candidates: optional('json'),
    blob_path: optional('text'),
    blob_link: optional('link'),
    blob_candidates: optional('json'),
  },
  attempts: {
    session: required('text'),
    run_id: required('text'),
    attempt: required('int'),
    rig_id: required('text'),
    started_at: required('timestamp'),
    settled_at: required('timestamp'),
    exposure_seconds: required('real'),
    outcome: required('text'),
    message: optional('text'),
    request_id: optional('text'),
    operation_id: optional('text'),
    cria_image_id: optional('text'),
    frame_id: optional('text'),
    frame_link: optional('link'),
    frame_candidates: optional('json'),
    operation_link: optional('link'),
    operation_candidates: optional('json'),
    detected_stars: optional('int'),
    median_hfr_px: optional('real'),
  },
  indi_ops: {
    session: required('text'),
    operation_id: required('text'),
    request_id: required('text'),
    instance_id: required('text'),
    device_id: required('text'),
    indi_device: optional('text'),
    kind: required('text'),
    accepted_at: required('timestamp'),
    started_at: optional('timestamp'),
    settled_at: required('timestamp'),
    outcome: required('text'),
    outcome_reason: optional('text'),
    outcome_message: optional('text'),
    parameters: required('json'),
    image_id: optional('text'),
    image_bytes: optional('int'),
  },
  indi_events: {
    session: required('text'),
    at: required('timestamp'),
    conn: required('int'),
    direction: required('text'),
    n: required('int'),
    kind: required('text'),
    device: optional('text'),
    property: optional('text'),
    state: optional('text'),
    values: optional('json'),
    changed: optional('json'),
    text: optional('text'),
    operation_id: optional('text'),
    operation_link: optional('link'),
    operation_candidates: optional('json'),
  },
  indi_images: {
    session: required('text'),
    at: required('timestamp'),
    conn: required('int'),
    n: required('int'),
    device: optional('text'),
    property: optional('text'),
    element: required('text'),
    blob_path: required('text'),
    blob_bytes: optional('int'),
    operation_id: optional('text'),
    operation_link: optional('link'),
    operation_candidates: optional('json'),
    image_id: optional('text'),
    image_bytes: optional('int'),
  },
  mount: {
    session: required('text'),
    /** `csv` for the observer's mount-watch log, `indi` for the recording's mount properties. */
    source: required('text'),
    sampled_at: required('timestamp'),
    ra_hours: required('real'),
    dec_degrees: required('real'),
    lst_hours: optional('real'),
    hour_angle_hours: optional('real'),
    tracking: optional('bool'),
    slewing: optional('bool'),
    parked: optional('bool'),
    pier_side: optional('text'),
    track_mode: optional('text'),
  },
  spans: {
    session: required('text'),
    trace_id: required('text'),
    span_id: required('text'),
    name: required('text'),
    started_at: required('timestamp'),
    ended_at: required('timestamp'),
    duration_ms: required('real'),
    status_code: required('int'),
    attributes: required('json'),
  },
} as const

export type TableName = keyof typeof tables

// SAFETY: Object.keys of the `tables` literal returns exactly its keys.
export const tableNames = Object.keys(tables) as TableName[]

export type FrameRow = RowOf<typeof tables.frames>

export type AttemptRow = RowOf<typeof tables.attempts>

export type IndiOpRow = RowOf<typeof tables.indi_ops>

export type IndiEventRow = RowOf<typeof tables.indi_events>

export type IndiImageRow = RowOf<typeof tables.indi_images>

export type MountRow = RowOf<typeof tables.mount>

export type SpanRow = RowOf<typeof tables.spans>

export interface Tables {
  readonly frames: readonly FrameRow[]
  readonly attempts: readonly AttemptRow[]
  readonly indi_ops: readonly IndiOpRow[]
  readonly indi_events: readonly IndiEventRow[]
  readonly indi_images: readonly IndiImageRow[]
  readonly mount: readonly MountRow[]
  readonly spans: readonly SpanRow[]
}

export function createTableSql(name: TableName): string {
  const schema: TableSchema = tables[name]

  const columns = Object.entries(schema).map(
    ([column, { kind, nullable }]) => `"${column}" ${sqlTypes[kind]}${nullable ? '' : ' NOT NULL'}`,
  )

  return `CREATE TABLE "${name}" (${columns.join(', ')})`
}
