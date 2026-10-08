# Acquisition archive

Every exposure Vela takes through Cria is preserved here, exactly as Cria delivered it, before any consumer looks at the pixels. Capture, autofocus, framing and alignment all reach the camera through the same Cria adapter (`../cria/equipment.ts`), so preservation does not depend on which feature asked, on Keep, or on whether previews and analysis succeed. A blurred, obstructed or failed frame is preserved like any other.

This is additive loss prevention. It does not choose the permanent archive format (exact ImageBytes versus verified lossless FITS is still open) and it does not replace FITS export or the saved-image gallery.

## What is stored

```
<root>/<criaStoreId>/<imageId>/
  original.imagebytes   exact source bytes
  context.json          immutable manifest, written once
  receipt.json          written once, after both files are re-read and verified
  acknowledgement.json  Cria accepted that receipt
```

The root is `VELA_ACQUISITIONS_PATH`, or `acquisitions/` beside the rig catalog. A Cria rig cannot be composed without it.

`context.json` records the Cria source identities (store, image, operation, request, digest, length), Cria's image description and its acquisition context (requested settings and camera observations at admission, each with status and time), and Vela's own facts: the purpose of the exposure and whether it was preserved on the acquisition path or by recovery. Unknown facts stay unknown; later analysis is not written back into this manifest.

## Order of operations

1. The adapter downloads the original and checks its SHA-256 (`@vela/cria`).
2. `preserve` writes both files into a staging directory with `fsync`, renames it into place and syncs the parent directory.
3. It re-reads both files, compares the original with the Cria digest and length, and hashes the manifest.
4. It writes `receipt.json` once. Repeating `preserve` returns the same receipt.
5. The custody coordinator (`../cria/custody.ts`) sends that receipt to Cria and records the acknowledgement.
6. Only now does the adapter return the frame to its consumer.

If any step fails, the consumer still receives its frame and Cria keeps its copy. Nothing in this path starts another exposure.

## Recovery

`createCriaCustody(...).recover()` runs when equipment composition starts and every 30 seconds:

- receipts that were written but never acknowledged are re-verified and sent again, with the same receipt ID;
- originals Cria still lists as `retained` are fetched again by image ID and preserved, including results of operations that remain uncertain. The device interlock is left alone.

An archived copy that no longer matches its source is reported as a problem and never "repaired" by rewriting it. Interrupted staging directories are Vela's own unverified copies and are discarded on open; Cria still holds the original.

## Known limits

- No destination-space forecast or user-visible archive status yet. A persistently failing archive shows up as logged errors and, eventually, Cria refusing new captures once its custody budget is full.
- Process-crash ordering is covered by tests. Power-loss guarantees depend on the filesystem honouring `fsync` and directory sync, which is not separately qualified.
- Archive deletion, backup and replication are not provided; they need an Observer retention policy.
