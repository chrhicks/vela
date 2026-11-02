# Attestation

Checks, when the server starts, that what a solve and a move depend on is what Chris pinned. A mismatch is a warning on the rig page and in the run log. It never blocks anything and never pages the phone.

| Item | Pinned as |
| --- | --- |
| `astap` | SHA-256 of the ASTAP binary (`VELA_ASTAP`). |
| `catalog` | One SHA-256 over every file under the star catalog (`VELA_STAR_CATALOG`): each file's path and own SHA-256, sorted by path. |
| `cria/<rig>` | What Cria's `GET /health` says apart from `status`. Today that is `protocolVersion`; a build id in the reply is pinned as soon as Cria sends one. |
| `optics/<rig>` | The rig catalog's focal length and imaging camera name. Pixel size and binning are not in the catalog; the camera reports them with each exposure. |

The manifest is `attestation.json` next to `rigs.yaml` in Vela's data directory.

## Statuses

| Status | Meaning | Warns |
| --- | --- | --- |
| `match` | Same as the manifest. | no |
| `changed` | Readable, and different. | yes |
| `missing` | Pinned, and not readable now: the file is gone, Cria did not answer within 3 s. | yes |
| `unpinned` | Not in the manifest. The first check of a new install pins everything and files every item as `unpinned`. An item added later, such as a new rig, stays `unpinned` until the next re-pin. | no |

The manifest is never rewritten by a check except the first one. A manifest that cannot be read warns on every rig and is not replaced until it is pinned again.

## When it runs

`server.ts` starts one check right after the server listens and does not wait for it, so hashing cannot hold up a request. Files are read one at a time with async streams. On thuban the real catalog (1,476 files, 107 MB) hashes in about 0.3 to 0.5 s and the event loop never lagged.

Each check files one `attestation` event per rig in the run log, with every item that rig depends on: its status, the pinned value and the value read now.

## Pinning again

After an intended change (a new catalog, an ASTAP update, a new focal length), pin what is installed now:

```sh
curl -X POST -H 'content-type: application/json' -d '{}' http://localhost:3001/api/attestation/pin
```

That replaces the manifest, checks again, and the warnings clear.
