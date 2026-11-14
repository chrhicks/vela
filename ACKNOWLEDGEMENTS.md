# Acknowledgements

Vela's code is under the MIT license (`LICENSE`). The data below belongs to its authors and keeps its own license.

## Stellarium DSO Catalog

The deep-sky object catalog of the Stellarium planetarium, and its list of common names, by the Stellarium developers.

- Source: https://github.com/Stellarium/stellarium, files `nebulae/default/catalog.txt` and `nebulae/default/names.dat`
- License: GNU General Public License, version 2 or later
- In this repository: none of the data. `src/bin/catalog-setup.ts` downloads the two files at the revision named in `src/catalog/stellarium/source.ts` and loads them into a local database, which records the revision, each file's address and its SHA-256.

Stellarium compiled the catalog from the SIMBAD Astronomical Database, the NASA/IPAC Extragalactic Database, and the catalogs of Sharpless, Rodgers, Campbell and Whiteoak, van den Bergh, Lynds, Cederblad, Barnard, Melotte and Collinder as distributed by VizieR and NASA ADS. Each common name in `names.dat` cites the books and sites it was taken from.

## OpenNGC

A database of NGC and IC objects by Mattia Verga and contributors.

- Source: https://github.com/mattiaverga/OpenNGC
- License: Creative Commons Attribution-ShareAlike 4.0 International
- In this repository: `src/catalog/data.ts`, adapted from `database_files/NGC.csv` and `database_files/addendum.csv`. The license text is `src/catalog/CC-BY-SA-4.0.txt`, the authors are in `src/catalog/AUTHORS.OpenNGC`, and `src/catalog/README.md` lists the pinned revision and each adaptation.

OpenNGC acknowledges the NASA/IPAC Extragalactic Database, HyperLEDA, SIMBAD, HEASARC and Harold Corwin's NGC/IC positions and notes.
