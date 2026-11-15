# Target catalog

## The catalog database

No catalog data is in this repository. `node src/bin/catalog-setup.ts <config.json>` downloads each source and writes one SQLite file, the `catalog.database` setting. The file is built beside its final name and moved into place when complete, so a failed setup leaves the previous catalog.

| Table or view | Holds |
|---|---|
| `sources` | One row per source: name, authors, version, homepage, license and when it was downloaded |
| `source_files` | One row per downloaded file: address, size and SHA-256 |
| `stellarium_objects` | `catalog.txt` of the Stellarium DSO Catalog, one row per object, every column as the file gives it: `0` in a catalog number means none, `99` in a magnitude means unknown |
| `stellarium_names` | `names.dat`: the catalog prefix and identifier, the name, and the references the file cites for it |
| `stellarium_designations` (view) | One row per catalog number an object has, written the usual way (`NGC 7000`, `Sh2-132`) |
| `stellarium_common_names` (view) | Each name of `stellarium_names` with the object it belongs to |
| `openngc_objects` | `NGC.csv` of OpenNGC, one row per object, every column as text as the file gives it |
| `openngc_placed` | Worked out at setup for each OpenNGC object that is not a duplicate entry: its position in degrees, and the Stellarium object it is the same as, if any |
| `openngc_names` | Worked out at setup: each OpenNGC object's designations and common names, one per row |
| `targets` (view) | One row per object: id, source, name, common name, how many references `names.dat` cites across its names, whether it has a Sharpless or RCW number (both are catalogues of hydrogen regions), type, J2000 position in degrees, size in arcminutes, magnitudes. Unknown values are null |
| `target_names` (view) | One row per name a target can be found by: every designation and every common name, with its place in the order they are shown |

An OpenNGC object is the same as a Stellarium object when it has the same NGC or IC number, or lies within `catalog.sameObjectArcseconds` of one. Then its names are added to that target. Otherwise it is a target of its own, with OpenNGC's type code.

A target's `name` is its first designation in the order of `src/catalog/stellarium/designations.ts` (Messier, NGC, IC, then the others). Its `commonName` is the name `names.dat` cites the most references for; the last in the file wins a tie, as in Stellarium. `type` is Stellarium's type code.

## Reading it

`catalog.ts` reads `targets` and `target_names` once, when the service starts, and searches them in memory: an exact name first, then names that start with the text, then names that contain it; among equals, the target that goes by the name comes before one that only also has it. Typed J2000 coordinates are a target too (`position.ts`). Run the setup again and restart the service to change the catalog. Without a catalog file the service starts, says so in its log, and finds only typed coordinates.
