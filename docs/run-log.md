# Run log

The run log is the one record of what Vela's Cria client saw. The server writes it when `VELA_RUN_LOG_DIR` is set (`/data/run-log` in `compose.yaml`) and keeps nothing when it is unset.

## Format

One JSONL file per server run, `run-<start time>-<part>.jsonl`, in that directory. Each line is one `@vela/rig-events` envelope in canonical JSON, so `decodeLine` reads it. A Cria connection reports four kinds, and each capture attempt files a `frame` event:

| Kind | Holds |
| --- | --- |
| `cria.state` | every snapshot that arrives, whole, with the time Cria made it (`at`) and the time Vela saw it (`seenAt`). A reading whose only change is a new `observedAt` is kept. |
| `cria.exchange` | one request to Cria with its reply. |
| `cria.image` | whether a fetched original matched its size and SHA-256. The bytes are never kept. |
| `cria.stream` | the event stream opening and ending. |
| `frame` | one settled exposure attempt, with why it failed if it did, the ids Cria gave it and the saved FITS (`docs/local-tracing.md`). Its rig is the catalog rig id. |

The rig is the Cria rig id from `cria.json`, which must be lowercase letters, digits and hyphens. The source is `vela:cria`.

Journals written before this change (`cria-journal*.jsonl` under `traces/`) stay where they are. `createJournalImporter` reads them. Nothing writes that format now.

`readFrameRecords` in `@vela/rig-frames` reads `frame` events and the older `traces/frames.jsonl` alike. The offline tools (`tools/rig-session`, and `backfill` and `indi-parity` in `tools/rig-model`) take the run log directory or a file of either format. `createLogReader` in `@vela/rig-events` tells a run-log line from a journal line by the line, so there is no flag.

## Rotation and retention

A file is closed when the next write would pass 256 MiB, and the next write opens a new part. At most 96 files stay in the directory, this run's included; older run files are deleted. Other files in the directory are never touched. The arithmetic is next to the constants in `apps/server/src/run-log/run-log.ts`:

- The largest recorded `cria.state` line was 38,063 bytes. At one a second that is about 3.3 GiB a day and 1.65 GiB for a 12 hour night.
- 256 MiB holds about 1 h 49 min of snapshots, so a night is seven files and never reaches a cap.
- 96 files keep 24 GiB: 14 twelve-hour nights, or 7 days around the clock.

The journal this replaced counted what its file already held against one 256 MiB cap and stopped for good on 2026-10-25.

## A failing disk

The log never switches itself off. A write that fails closes its file, so a torn line is only ever the last line of a file, and is tried again in a new file after 1 s, doubling to 30 s. Events wait in a queue of up to 64 MiB, about 27 minutes of snapshots. Past that, new events are dropped and counted. When the disk takes writes again, one `gap` event per rig and source records how many were dropped and over what span.

`close` waits 2 s for the disk, then gives up on what is still queued, so a stalled disk cannot hold the server at shutdown.

## Health

`GET /api/health` carries the log's state next to the server's:

```json
{ "status": "ok", "runLog": { "state": "ok", "file": "run-20261101T200000123Z-00001.jsonl", "writtenBytes": 0, "pendingBytes": 0, "dropped": 0, "lastWriteAt": null, "lastError": null } }
```

`state` is `ok`, `retrying` (the last write failed and the log is trying again), `closed`, or `off` when no directory is set. `status` stays `ok` while the log retries, so a full disk does not make the container unhealthy.
