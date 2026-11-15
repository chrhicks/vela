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

- Source: https://github.com/mattiaverga/OpenNGC, file `database_files/NGC.csv`
- License: Creative Commons Attribution-ShareAlike 4.0 International
- In this repository: none of the data. `src/bin/catalog-setup.ts` downloads the file at the revision named in `src/catalog/openngc/source.ts` and loads it into the local database beside the Stellarium DSO Catalog.

OpenNGC acknowledges the NASA/IPAC Extragalactic Database, HyperLEDA, SIMBAD, HEASARC and Harold Corwin's NGC/IC positions and notes.

## Digitized Sky Survey, coloured

The DSS colour survey as a HiPS tile set: the photographic sky surveys digitized by the Space Telescope Science Institute, coloured and tiled by the Centre de Données astronomiques de Strasbourg.

- Source: https://skies.esac.esa.int/DSSColor, the mirror kept by the European Space Agency
- Credit, as the survey gives it: Digitized Sky Survey - STScI/NASA, Colored & Healpixed by CDS
- Terms: http://archive.stsci.edu/dss/copyright.html
- In this repository: none of the pictures. `src/bin/sky-setup.ts` downloads the tiles of one HiPS order into a local folder, with the survey's own `properties` file beside them.

The Digitized Sky Surveys were produced at the Space Telescope Science Institute under U.S. Government grant NAG W-2166, from photographic data obtained with the Oschin Schmidt Telescope on Palomar Mountain and the UK Schmidt Telescope.
