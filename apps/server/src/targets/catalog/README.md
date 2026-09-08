# Local target catalog

This boundary provides a bundled, offline OpenNGC catalog and addendum. It exports
`listTargets()`, `getTarget(id)`, and `searchTargets(query, limit = 50)` from
`index.ts`. IDs are lowercase original catalog designations, including original
zero padding (`ngc0224`, `ngc6205`, `b033`). Search supports case, whitespace, and
catalog zero-padding normalization. Exact alias matches precede substrings; ties
use stable ID order. An empty search returns the first catalog entries, not
observing recommendations. Search limits are integers from 1 through 200.

Positions are J2000 equatorial degrees. Source major/minor axes are arcminutes;
missing sizes stay null. Sizes are catalog measurements of differing provenance,
not guaranteed photographic nebula boundaries. Heart and Soul keep the source
cluster-and-nebula positions and extents. There is no visibility ranking, online
resolver, ephemeris, planning model, or runtime network dependency here.

## Source, attribution, and license

`data.ts` is an adapted database from [OpenNGC by Mattia Verga and
contributors](https://github.com/mattiaverga/OpenNGC), licensed under
[Creative Commons Attribution-ShareAlike 4.0 International](https://creativecommons.org/licenses/by-sa/4.0/).
The adaptation is distributed under the same license. The full license is in
`CC-BY-SA-4.0.txt`; upstream authors are retained in `AUTHORS.OpenNGC`. This data
license does not relicense Vela's surrounding application code.

Pinned revision: `da90466031b0372c896588b85be6016c617e205b`.
Inputs: `database_files/NGC.csv` and `database_files/addendum.csv` at that revision.
The source field definitions are in upstream `NGC_guide.txt`. Source SHA-256
checksums are embedded in `generate.py` and checked before generation.

OpenNGC acknowledges NASA/IPAC Extragalactic Database (operated by JPL/Caltech
under contract with NASA), HyperLEDA, SIMBAD (operated at CDS, Strasbourg),
HEASARC, and Harold Corwin's NGC/IC positions and notes. See the pinned
[upstream README](https://github.com/mattiaverga/OpenNGC/blob/da90466031b0372c896588b85be6016c617e205b/README.md)
for their source details. No original images or third-party prose are bundled.

The adaptation converts sexagesimal coordinates to degrees, expands type names,
selects useful fields, normalizes catalog labels, and omits duplicate/nonexistent
records and records with no position. It retains 13,372 objects. Catalog
cross-references and common names become searchable aliases. IC3322A's source
`+07:12:60.0` declination is explicitly carried to `+07:13:00.0`, the same angle;
other malformed coordinates and nonpositive/nonfinite extents fail generation.

## Reviewed name adjustments

Names are scoped to original records; corrections never move coordinates or
silently replace a source object's identity.

- M13 / NGC6205: [SIMBAD identification](https://simbad.u-strasbg.fr/simbad/sim-basic?Ident=m13).
  Added familiar Great Hercules Cluster / Great Globular Cluster in Hercules names.
- M31 / NGC0224: [NASA Hubble identification](https://science.nasa.gov/asset/hubble/m31/).
- Crescent / NGC6888: [NASA Caldwell 27](https://science.nasa.gov/mission/hubble/science/explore-the-night-sky/hubble-caldwell-catalog/caldwell-27/).
- North America / NGC7000: [NASA Caldwell 20](https://science.nasa.gov/image-detail/ngc7000_inset1_final-01/).
- Heart / IC1805 and Soul (Embryo) / IC1848: [NASA WISE Heart and Soul](https://science.nasa.gov/photojournal/heart-and-soul/).
  Added aliases; the catalog positions refer to their associated clusters/nebulae.
- Horsehead / B033 (Barnard 33) and Flame / NGC2024:
  [ESO VISTA identification](https://www.eso.org/public/images/eso0949a/).
  Added Barnard 33 and Flame names. Suppressed the erroneous upstream
  `Flame Nebula,Orion B` common names on IC0434; that record retains its identity,
  coordinates, and type. IC434 is not made into the Horsehead or Flame target.

Other upstream common names are retained as supplied, without claiming universal
name verification. Provenance and aliases can be refined as observing needs expose
concrete errors.

## Regeneration and verification

From the repository root, using Python 3's standard library and network access:

```sh
python apps/server/src/targets/catalog/generate.py
python -m unittest discover -s apps/server/src/targets/catalog -p 'test_*.py'
pnpm exec vitest run apps/server/src/targets/catalog/catalog.test.ts
```

Generation downloads only the two pinned, checksum-verified files. `data.ts` is
tracked so builds and runtime require neither Python nor network access. To
update the snapshot, deliberately change the pin/checksums, inspect source and
alias changes, regenerate, and rerun the focused checks.
