import { designationsInNamingOrder, type Designation } from './designations.ts'
import { nameColumns } from './names.ts'
import { objectColumnDefinitions } from './objects.ts'

const quoted = (text: string) => `'${text.replaceAll("'", "''")}'`

const present = ({ column, numbered }: Designation) => (numbered ? `${column} > 0` : `${column} IS NOT NULL`)

const identifier = ({ column, numbered }: Designation) => (numbered ? `CAST(${column} AS TEXT)` : column)

const designationRows = designationsInNamingOrder
  .map(designation => `SELECT dso, ${quoted(designation.prefix)} AS prefix, ${identifier(designation)} AS identifier, ${quoted(designation.label)} || ${designation.column} AS name FROM stellarium_objects WHERE ${present(designation)}`)
  .join('\nUNION ALL\n')

const firstDesignation = designationsInNamingOrder.map(designation => `WHEN ${present(designation)} THEN ${quoted(designation.label)} || ${designation.column}`).join('\n    ')

const designationIndexes = designationsInNamingOrder
  .map(designation => `CREATE INDEX stellarium_objects_by_${designation.column} ON stellarium_objects (${designation.column}) WHERE ${present(designation)};`)
  .join('\n')

const named = ({ column, numbered }: Designation) => (numbered ? `object.${column} = CAST(name.identifier AS INTEGER) AND object.${column} > 0` : `object.${column} = name.identifier`)

const commonNameRows = designationsInNamingOrder
  .map(designation => `SELECT object.dso AS dso, name.name AS name, name.line AS line, name.citations AS citations FROM stellarium_names AS name JOIN stellarium_objects AS object ON ${named(designation)} WHERE name.prefix = ${quoted(designation.prefix)}`)
  .join('\nUNION ALL\n')

export const stellariumTables = `
CREATE TABLE stellarium_objects (${objectColumnDefinitions.join(', ')}, PRIMARY KEY (dso));

CREATE TABLE stellarium_names (${nameColumns.map(column => (column === 'line' ? 'line INTEGER PRIMARY KEY' : column)).join(', ')});

CREATE INDEX stellarium_names_by_prefix ON stellarium_names (prefix);

${designationIndexes}

CREATE VIEW stellarium_designations AS
${designationRows};

CREATE VIEW stellarium_common_names AS
${commonNameRows}
UNION ALL
SELECT CAST(identifier AS INTEGER), name, line, citations FROM stellarium_names WHERE prefix = '';

CREATE VIEW stellarium_preferred_names AS
SELECT dso, name FROM (
  SELECT dso, name, row_number() OVER (PARTITION BY dso ORDER BY length(citations) - length(replace(citations, ',', '')) DESC, line DESC) AS position
  FROM stellarium_common_names
) WHERE position = 1;

CREATE VIEW stellarium_targets AS
SELECT
  'stellarium-' || object.dso AS id,
  'stellarium' AS source,
  COALESCE(
    CASE
    ${firstDesignation}
    END,
    preferred.name
  ) AS name,
  preferred.name AS commonName,
  type,
  ra AS raDegrees,
  dec AS decDegrees,
  NULLIF(majorAxis, 0) AS majorAxisArcminutes,
  NULLIF(minorAxis, 0) AS minorAxisArcminutes,
  NULLIF(vMag, 99) AS vMagnitude,
  NULLIF(bMag, 99) AS bMagnitude
FROM stellarium_objects AS object
LEFT JOIN stellarium_preferred_names AS preferred ON preferred.dso = object.dso;

CREATE VIEW stellarium_target_names AS
SELECT 'stellarium-' || dso AS target, name, 0 AS common FROM stellarium_designations
UNION ALL
SELECT 'stellarium-' || dso, name, 1 FROM stellarium_common_names;
`
