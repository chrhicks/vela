import { objectColumns } from './objects.ts'

export const placedColumns: ReadonlyArray<string> = ['name', 'raDegrees', 'decDegrees', 'stellariumDso']

export const otherNameColumns: ReadonlyArray<string> = ['name', 'alias', 'common', 'place']

const afterStellarium = 10_000

export const openNgcTables = `
CREATE TABLE openngc_objects (${objectColumns.map(column => (column === 'name' ? 'name TEXT PRIMARY KEY' : `${column} TEXT`)).join(', ')});

CREATE TABLE openngc_placed (name TEXT PRIMARY KEY REFERENCES openngc_objects (name), raDegrees NUMERIC, decDegrees NUMERIC, stellariumDso INTEGER);

CREATE TABLE openngc_names (name TEXT REFERENCES openngc_objects (name), alias TEXT, common INTEGER, place INTEGER);

CREATE INDEX openngc_names_by_name ON openngc_names (name);

CREATE VIEW openngc_targets AS
SELECT
  'openngc-' || lower(replace(object.name, ' ', '-')) AS id,
  'openngc' AS source,
  (SELECT alias FROM openngc_names AS named WHERE named.name = object.name AND named.common = 0 ORDER BY place LIMIT 1) AS name,
  (SELECT alias FROM openngc_names AS named WHERE named.name = object.name AND named.common = 1 ORDER BY place LIMIT 1) AS commonName,
  0 AS nameCitations,
  0 AS inHydrogenRegionCatalog,
  object.type AS type,
  placed.raDegrees AS raDegrees,
  placed.decDegrees AS decDegrees,
  CAST(object.majAx AS REAL) AS majorAxisArcminutes,
  CAST(object.minAx AS REAL) AS minorAxisArcminutes,
  CAST(object.vMag AS REAL) AS vMagnitude,
  CAST(object.bMag AS REAL) AS bMagnitude
FROM openngc_objects AS object
JOIN openngc_placed AS placed ON placed.name = object.name
WHERE placed.stellariumDso IS NULL;

CREATE VIEW openngc_target_names AS
SELECT
  CASE WHEN placed.stellariumDso IS NULL THEN 'openngc-' || lower(replace(named.name, ' ', '-')) ELSE 'stellarium-' || placed.stellariumDso END AS target,
  named.alias AS name,
  named.common AS common,
  ${afterStellarium} + named.place AS place
FROM openngc_names AS named
JOIN openngc_placed AS placed ON placed.name = named.name;
`
