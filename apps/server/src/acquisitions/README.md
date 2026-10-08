# Acquisition archive

Every exposure Vela takes through Cria is meant to be preserved here, exactly as Cria delivered it. Capture, autofocus, framing and alignment all reach the camera through the same Cria adapter (`../cria/equipment.ts`), so preservation does not depend on which feature asked, on Keep, or on whether previews and analysis succeed. A blurred, obstructed or failed frame is treated like any other.

This is additive loss prevention. It does not choose the permanent archive format (exact ImageBytes versus verified lossless FITS is still open) and it does not replace FITS export or the saved-image gallery.

## Four states of one acquisition

Keep these apart when reading code, logs or status:

| State | Meaning | Who holds the original |
| --- | --- | --- |
| **Attempted** | The adapter tried to preserve the original before returning the frame | Cria; Vela may have a partial or complete copy |
| **Pending** | That attempt failed or was interrupted. The consumer may already have its pixels | Cria keeps its copy until recovery finishes |
| **Verified** | Both files were re-read, the manifest matched the expected acquisition, and `receipt.json` exists | Both |
| **Acknowledged** | Cria accepted that receipt (`acknowledgement.json`). Cria may now release its copy | Vela; Cria only if its release setting keeps both |

A consumer receiving pixels does not mean preservation is verified. Automatic recovery finishes pending work later, but an active workflow cannot always rely on rereading an original from Cria after Cria has released it; the adapter then uses Vela's own verified copy when one exists.

## What is stored

```
<root>/<criaStoreId>/
  .intents/<requestId>.json   Vela's acquisition intent, written before the request is sent
  <imageId>/
    original.imagebytes       exact source bytes
    context.json              complete manifest, written once
    receipt.json              written once, after verification
    acknowledgement.json      Cria accepted that receipt
```

The root is `VELA_ACQUISITIONS_PATH`, or `acquisitions/` beside the rig catalog. A Cria rig cannot be composed without it.

**Intent** records what only Vela knows: rig, device, purpose, requested exposure and expected camera name, keyed by the exact Cria request ID. It is written durably before the request is sent, so it survives a lost admission response or a Vela restart. No capture run or session identity is recorded, because capture runs are deliberately not durable; none is invented.

**`context.json`** is a strict, versioned manifest:

- `source`: Cria store, image, operation and request IDs, digest and length;
- `cria`: binding, device, instance and camera identities, Cria's verified image description, and its acquisition context (requested parameters plus labelled camera observations, or an explicit `migratedFrom` for records Cria migrated);
- `intent`: the recorded intent, or `null` when none was recorded (purpose unknown, not guessed);
- `preservation`: whether the acquisition path or recovery wrote it, and when.

Unknown facts stay unknown; later analysis is not written back into this manifest.

## Order of operations

1. Before sending the capture request, the adapter records intent durably and takes ownership of that request ID. If intent cannot be recorded, the request is not sent.
2. After the confirmed result, the adapter downloads the original and checks its SHA-256 (`@vela/cria`).
3. `preserve` writes both files into a staging directory with `fsync` and syncs it. It creates the store directory if needed and syncs that directory's parent, renames the staging directory into place, and syncs the store directory. Every newly created directory, including the archive root and its missing ancestors, is synced in its parent.
4. It re-reads both files and checks the original against the source digest. It parses the manifest strictly and requires it to equal the **expected acquisition**, rebuilt independently from Cria's custody record and Vela's recorded intent. A stored manifest that is incomplete or differs is a conflict, never certified by hashing it.
5. It writes `receipt.json` through a synced temporary file and rename, then syncs its directory. Repeating `preserve` returns the same receipt. Any path that hands out an existing receipt, or reuses an existing directory, syncs it again first, in case an earlier attempt was interrupted just before its sync.
6. The custody coordinator (`../cria/custody.ts`) sends that receipt to Cria and records the acknowledgement.
7. The adapter returns the frame.

If preservation fails, the consumer still receives its frame, preservation stays pending, and Cria keeps its copy. Nothing in this path starts another exposure.

## Recovery

`createCriaCustody(...).recover()` runs when equipment composition starts and every 30 seconds. That cadence is an engineering default, not a retention policy.

- Receipts that were written but never acknowledged are re-verified and sent again, with the same receipt ID.
- Originals Cria still lists as `retained` are preserved, including results of operations that remain uncertain. The expected context comes from Cria's custody record plus the recorded intent. An already published copy is finished against that expected context; otherwise the same original is fetched again by image ID. Requests an active acquisition owns are skipped, so recovery cannot take a result from a capture whose admission response is still delayed. The device interlock and the operation's uncertainty are left alone.
- A copy published without a receipt whose original Cria no longer retains is reported, not vouched for, unless an active acquisition finished it meanwhile and Cria holds that same receipt.
- If the archive cannot write (for example, a full or read-only disk), the first failure ends the cycle with one "Archive unavailable" problem. The remaining originals wait for the next cycle instead of each being downloaded again.

An archived copy or manifest that no longer matches is reported as a problem and never "repaired" by rewriting it. Interrupted staging directories are Vela's own unverified copies and are discarded on open; Cria still holds the original.

## Known limits

- No destination-space forecast or user-visible archive status yet. A persistently failing archive shows up as logged errors and, eventually, Cria refusing new captures once its custody budget is full.
- Ownership of in-flight requests is per process. Vela runs a single server per archive; a second concurrent process is not coordinated, although the active acquisition can still read the second process's verified copy.
- Intent files are kept after acknowledgement (a few hundred bytes each); compaction is later work.
- Directory synchronisation follows the Linux `fsync` contract. Process-crash and injected-failure ordering are tested. Power-loss behaviour of the actual filesystem is not qualified.
- Archive deletion, backup and replication are not provided; they need an Observer retention policy.
