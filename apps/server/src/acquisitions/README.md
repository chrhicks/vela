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
3. `preserve` writes both files into a staging directory with `fsync` and syncs it. It creates the store directory if needed, renames the staging directory into place, and syncs the store directory. Every directory on the path from the archive root down to the store, and from the filesystem root down to the archive root when the archive opens, is synced in its parent each time it is used, not only when this process created it: an earlier attempt may have created a directory and been interrupted before syncing its parent, and the directory existing does not prove the link to it is durable. The same applies to `.intents/` before an intent is written.
4. It re-reads both files and checks the original against the source digest. It parses the manifest strictly and requires it to equal the **expected acquisition**, rebuilt independently from Cria's custody record and Vela's recorded intent. A stored manifest that is incomplete or differs is a conflict, never certified by hashing it.
5. It writes `receipt.json` through a synced temporary file, publishes it with a hard link that fails rather than replace an existing receipt, then syncs its directory. If a receipt is already there, that stored receipt is returned instead of the new one. Repeating `preserve` returns the same receipt. Any path that hands out an existing receipt, or reuses an existing directory, syncs it again first, in case an earlier attempt was interrupted just before its sync.
6. The custody coordinator (`../cria/custody.ts`) sends that receipt to Cria and records the acknowledgement.
7. The adapter returns the frame.

If preservation fails, the consumer still receives its frame, preservation stays pending, and Cria keeps its copy. Nothing in this path starts another exposure.

## One owner per archive

Opening the archive takes ownership of it before anything else touches it: before staging cleanup, intent, preservation, recovery or the HTTP server listening. The server opens it before it writes its rig catalog or saved-image directory, so a refused start changes nothing. Ownership is a Linux abstract-namespace socket named after the archive root's canonical real path (symbolic links resolved). Only one live socket in the same network namespace can hold that name, and the kernel releases it when the owning process exits or crashes, so there is no lock file to go stale and nothing to clear by hand. The release happens once every thread of the old process has finished exiting, so a restart issued in the same instant as a crash can be refused once; starting again succeeds.

A second open, from the same process or another Vela server started by accident against the same archive, fails with "already owned by {pid, openedAt}; refusing to open it twice". The server then exits before listening. It never takes over from an owner that is slow or busy, however long it waits, because only the owner's exit releases the name. `app.close()` waits for in-flight recovery and archive writes, then gives ownership up.

Without this, a second server could delete the first one's staging directory mid-publication or publish a different receipt for an image whose first receipt Cria had already accepted but whose acknowledgement was lost, and recovery would then resend a receipt Cria does not know.

## Recovery

`createCriaCustody(...).recover()` runs when equipment composition starts and every 30 seconds. That cadence is an engineering default, not a retention policy.

- Receipts that were written but never acknowledged are re-verified and sent again, with the same receipt ID.
- Originals Cria still lists as `retained` are preserved, including results of operations that remain uncertain. The expected context comes from Cria's custody record plus the recorded intent. An already published copy is finished against that expected context; otherwise the same original is fetched again by image ID. Requests an active acquisition owns are skipped, so recovery cannot take a result from a capture whose admission response is still delayed. The device interlock and the operation's uncertainty are left alone.
- A copy published without a receipt whose original Cria no longer retains is reported, not vouched for, unless an active acquisition finished it meanwhile and Cria holds that same receipt.
- If the archive cannot write (for example, a full or read-only disk), the first failure ends the cycle with one "Archive unavailable" problem. The remaining originals wait for the next cycle instead of each being downloaded again.

An archived copy or manifest that no longer matches is reported as a problem and never "repaired" by rewriting it. Interrupted staging directories are Vela's own unverified copies and are discarded on open; Cria still holds the original.

## Health and forecast

Tonight shows whether originals are preserved, not only whether capture is running (`../cria/archive-health.ts`, `GET /api/web/rigs/:rigId/archive`). One projection per Cria store joins, by image identity:

- **Cria's durable facts:** `GET /v2/storage` totals (validated strictly at the client) and pages of `missing` and `quarantined` records, which Cria's outstanding totals omit.
- **The archive's durable facts:** a census from directory listings and file sizes only. Nothing is re-read or hashed for a health read; integrity is still verified whenever a receipt is issued or handed out.
- **What only this server saw:** intent refusals, write failures, recent acquisitions and per-image attempts.

Each original is counted once:

| Shown as | Meaning |
| --- | --- |
| Arriving | Retained at Cria and owned by the active capture, which is preserving it now |
| Waiting at Cria | Retained at Cria and not yet copied; pending Vela copies are subtracted |
| Being verified | Copied to Vela without a receipt |
| Waiting for Cria to confirm | Receipted; Cria has not acknowledged it. A lost receipt response lands here, not as a lost image |
| Preserved | Receipted and acknowledged |

Totals are durable facts, so repeated or concurrent recovery cannot inflate them. A per-image issue has a stable reason (`source-unavailable`, `original-mismatch`, `context-mismatch`, `receipt-mismatch`, `acknowledgement-pending`, `receipt-conflict`, `unvouched-copy`, `missing-at-cria`, `quarantined-at-cria`) and is cleared only by that original's own success. A failed archive write is destination-wide, not one issue per image.

The two archive failures stay distinct. If intent cannot be recorded, the capture is refused before any request and the view says no exposure was requested; the next successful intent resolves the notice. If intent is recorded but originals cannot be written, capture continues and the view shows the archive as unavailable with the growing number waiting at Cria. Cria's own capacity refusal remains the only automatic stop.

The destination is compared with the folder Vela opened, by device and inode. A missing path, or one that now leads to another folder (an empty mount point after unmounting), is unavailable. Its free space is then measured wherever the path leads and labelled `other-location`. Operating-system messages are reduced to their error codes, so temporary file names and paths do not reach the page.

Forecasts use only measured evidence: the latest acquired original's length, the rate over the latest run at one cadence among the last ten acquisitions (an interval more than three times longer or shorter than the run's typical one ends it, so a pause or an autofocus burst is not averaged in; unknown with fewer than two, or once the next frame is overdue by three intervals), the bytes waiting at Cria, and Cria's own admission rules. The total a capture run needs is always unknown, because runs continue until stopped. They are estimates, not guarantees: saved FITS files, previews and other programs writing to either disk are not included.

Reads are cached for 5 seconds and coalesced across browsers. Cria reads are bounded: 50 pending copies are checked against Cria, 5 pages of missing records are counted, and the arriving check runs only when 20 or fewer originals are retained. Beyond those limits totals are marked partial.

The archive census grows with the archive, so it never runs on a health read's clock:

- **One census at a time,** shared by every reader. It runs in the background and is reused for ten times its own measured duration, and at least 5 seconds.
- **After that period,** a read answers at once with the existing census while a new one runs.
- **A read waits, for at most 1 second,** only when no census has finished yet or the last one is no longer current: older than 60 seconds or three reuse periods. If the census is still running after that second, the view says Vela is still counting, or marks totals partial with the time they were counted. Status is then unknown, never current.
- **Check archive now** waits up to 10 seconds for a census that starts after its recovery pass. It never returns a read that started before the check finished.

Measured on Polaris with sparse full-size originals. The measurement scripts and logs accompany the review evidence, outside this repository:

| Entries | Census | Health reads |
| --- | --- | --- |
| 2,000 | ~28 ms, ~34 KB of directory metadata read | — |
| 20,000 | ~300 ms | — |
| 100,000 (about 10 TB apparent) | ~1.4 s | Ten concurrent cold reads answered in ~1.0 s, saying Vela was still counting, and shared one census. Later reads took 3–5 ms. Event-loop delay stayed under 25 ms |

These are engineering bounds, not retention or storage policy.

**Check archive now** reruns the existing recovery pass: it resends the same receipts and copies the same retained originals. It never takes an exposure, replaces a receipt or context, clears an uncertain operation or rearms equipment. Health reads and this action are refused once shutdown begins.

## Known limits

- An archive that cannot record intent (unmounted, read-only or completely full) refuses every Cria capture before it is sent, with "Acquisition archive unavailable; capture not started". An archive that records intent but cannot store originals lets captures continue: frames are returned, Tonight shows the archive as unavailable, and Cria eventually refuses new captures once its custody budget is full. No earlier stop, pause or threshold is applied.
- Health counts what the archive's files say, not a fresh integrity check, and only for this server's own archive. An entry whose original file is gone is reported, never counted as preserved; a Cria `missing` record whose image Vela preserved and acknowledged is not an issue. The in-memory attempts, rate and refusal notices restart with the server; obligations are rebuilt from durable facts.
- The ownership guard excludes a second server only when all three match: **Linux, the same host and network namespace, and the same canonical archive path**. That covers the supported deployment, one personal Linux Vela server. It is not a distributed lock:
  - On other platforms the archive refuses to open rather than run unguarded.
  - Abstract socket names are private to a Linux network namespace. Containers or sandboxes with separate network namespaces that share the archive directory do not see each other's ownership.
  - An archive directory shared with another host over a network filesystem is not protected.
  - The same directory reached through a different mount (a bind mount or another mount point) has a different canonical path, so it is not recognised as the same archive.
- **Run one Vela archive per Cria store.** The ownership guard prevents two servers on one host and network namespace from sharing one archive path; it does not bind a Cria store to one archive. Two Vela servers with separate archive directories pointed at the same Cria are not coordinated (for example two Rift workspaces with copied Cria configuration): either may archive the other's originals, and Cria accepts whichever receipt arrives first and may release its copy. An active capture cannot read back an original the other server archived, so its capture can fail, and the only archived copy may sit in the other workspace's ignored `data/` folder. Recovery reports a receipt conflict as "another archive holds it".
- Intent files are kept after acknowledgement (a few hundred bytes each); compaction is later work.
- Directory synchronisation follows the Linux `fsync` contract. Process-crash, duplicate-process and injected-failure ordering are tested. Power-loss behaviour of the actual filesystem is not qualified.
- Archive deletion, backup and replication are not provided; they need an Observer retention policy.
