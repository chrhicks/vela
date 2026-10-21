#!/usr/bin/env python3
"""Count a night from Vela's observing traces and print one JSON report.

    python3 -I tools/trace-report/trace_report.py PATH [PATH ...]
        [--since ISO] [--until ISO] [--frames FRAMES.jsonl] [--saved-images DIR]

A pure log reader: it never imports or calls Vela and opens every input read-only.
Standard library only. The definitions behind every count are in the `definitions`
block of the report, so a reader does not have to find them here.

One PATH is expanded to itself plus `.1` to `.4` when they exist (Vela keeps five
files of at most 20 MiB). Two or more PATHs are used as given. The window is
`since <= startTime < until`; a time without an offset is read as UTC.

Exit codes: 0 report produced (warnings do not change it), 1 bad arguments, 2 input
refused on purpose, 3 environment failure. Errors are JSON on stdout too.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Callable

SCHEMA = "vela-trace-report/1"
ROTATED_SUFFIXES = (1, 2, 3, 4)
LIVE_FILE_SECONDS = 120
OTEL_STATUS_ERROR = 2

PERCENTILE_METHOD = (
    "nearest-rank: the sample at 1-based rank ceil(p*n/100) of the sorted values; "
    "no interpolation, so the p50 of an even n is the lower middle sample"
)
TIMING_BASIS = (
    "completed frames only (saved, unsaved, save-failed); stopped, lost, failed and "
    "uncertain frames never reached an image, so their durations are not timings. "
    "intervalMs is end to end between saved frames with consecutive frame indexes."
)


class FrameOutcome(str, Enum):
    SAVED = "saved"
    UNSAVED = "unsaved"
    LOST = "lost"
    SAVE_FAILED = "save-failed"
    STOPPED = "stopped"
    UNCERTAIN = "uncertain"
    FAILED = "failed"

    @staticmethod
    def parse(raw: str) -> FrameOutcome | None:
        try:
            return FrameOutcome(raw)
        except ValueError:
            return None


# Vela's controller counts a frame as completed once its image exists, before the save.
COMPLETED = frozenset({FrameOutcome.SAVED, FrameOutcome.UNSAVED, FrameOutcome.SAVE_FAILED})


@dataclass(frozen=True, slots=True)
class Frame:
    span_id: str
    run_id: str | None
    rig_id: str
    index: int
    outcome_name: str
    outcome: FrameOutcome | None
    start: datetime
    end: datetime
    duration_ms: float
    acquire_ms: float | None
    overhead_ms: float | None
    process_ms: float | None
    save_ms: float | None
    retry_count: int
    retry_ms: float


@dataclass(frozen=True, slots=True)
class RunStarted:
    run_id: str | None
    rig_id: str
    at: datetime
    exposure_seconds: float
    repeat: bool
    save_frames: bool


@dataclass(frozen=True, slots=True)
class RunEnded:
    run_id: str | None
    rig_id: str
    at: datetime
    phase: str
    completed: int
    lost: int
    saved: int
    error: str | None


@dataclass(frozen=True, slots=True)
class DeviceMarker:
    span_id: str
    device: str
    at: datetime
    recovered: bool
    reason: str | None
    interrupted_ms: float | None


@dataclass(frozen=True, slots=True)
class Interruption:
    device: str
    started: datetime
    reason: str | None
    recovered: datetime | None
    ms: float | None


@dataclass(frozen=True, slots=True)
class Run:
    run_id: str
    rig_id: str
    inferred: bool
    started: RunStarted | None
    ended: RunEnded | None
    frames: tuple[Frame, ...]
    frames_outside_window: int


Record = Frame | RunStarted | RunEnded | DeviceMarker


@dataclass(frozen=True, slots=True)
class Span:
    name: str
    span_id: str
    start: datetime
    is_error: bool
    discovery_timeout: bool
    device: str | None
    record: Record | None


@dataclass(frozen=True, slots=True)
class Rejected:
    name: str
    missing: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class Unparseable:
    pass


@dataclass(frozen=True, slots=True)
class Window:
    since: datetime | None
    until: datetime | None

    def contains(self, moment: datetime) -> bool:
        return (self.since is None or moment >= self.since) and (
            self.until is None or moment < self.until
        )


class UsageError(Exception):
    pass


class Refused(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def parse_time(raw: object) -> datetime:
    if not isinstance(raw, str):
        raise TypeError("time is not a string")
    moment = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    return moment.replace(tzinfo=timezone.utc) if moment.tzinfo is None else moment


def iso(moment: datetime | None) -> str | None:
    if moment is None:
        return None
    return moment.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _text(value: object) -> bool:
    return isinstance(value, str)


def _integer(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _flag(value: object) -> bool:
    return isinstance(value, bool)


def _num_or_none(attrs: dict, key: str) -> float | None:
    value = attrs.get(key)
    return float(value) if _number(value) else None


def _run_id(attrs: dict) -> str | None:
    run_id = attrs.get("capture.run.id")
    return run_id if _text(run_id) else None


def _build_frame(base: dict, attrs: dict) -> Frame:
    outcome_name = attrs["capture.frame.outcome"]
    duration = base["duration_ms"]
    retry_count = attrs.get("capture.read.retrying.count")
    return Frame(
        span_id=base["span_id"],
        run_id=_run_id(attrs),
        rig_id=attrs["capture.rig.id"],
        index=attrs["capture.frame.index"],
        outcome_name=outcome_name,
        outcome=FrameOutcome.parse(outcome_name),
        start=base["start"],
        end=base["end"],
        duration_ms=duration,
        acquire_ms=_num_or_none(attrs, "capture.acquire.ms"),
        overhead_ms=_num_or_none(attrs, "capture.overhead.ms"),
        process_ms=_num_or_none(attrs, "capture.process.ms"),
        save_ms=_num_or_none(attrs, "capture.save.ms"),
        retry_count=retry_count if _integer(retry_count) else 0,
        retry_ms=_num_or_none(attrs, "capture.read.retrying.ms") or 0.0,
    )


def _build_run_started(base: dict, attrs: dict) -> RunStarted:
    return RunStarted(
        run_id=_run_id(attrs),
        rig_id=attrs["capture.rig.id"],
        at=base["start"],
        exposure_seconds=float(attrs["capture.exposure.seconds"]),
        repeat=attrs["capture.run.repeat"],
        save_frames=attrs["capture.run.saveFrames"],
    )


def _build_run_ended(base: dict, attrs: dict) -> RunEnded:
    error = attrs.get("capture.run.error")
    return RunEnded(
        run_id=_run_id(attrs),
        rig_id=attrs["capture.rig.id"],
        at=base["start"],
        phase=attrs["capture.run.phase"],
        completed=attrs["capture.run.completed"],
        lost=attrs["capture.run.lost"],
        saved=attrs["capture.run.saved"],
        error=error if _text(error) else None,
    )


def _build_marker(recovered: bool) -> Callable[[dict, dict], DeviceMarker]:
    def build(base: dict, attrs: dict) -> DeviceMarker:
        reason = attrs.get("cria.reading.reason", attrs.get("cria.interrupted.message"))
        return DeviceMarker(
            span_id=base["span_id"],
            device=attrs["cria.device.id"],
            at=base["start"],
            recovered=recovered,
            reason=reason if _text(reason) else None,
            interrupted_ms=_num_or_none(attrs, "cria.interrupted.ms"),
        )

    return build


@dataclass(frozen=True, slots=True)
class SpanSpec:
    required: dict[str, Callable[[object], bool]]
    build: Callable[[dict, dict], Record]


# Trace lines carry no schema version, so the keys each known span needs are checked on every line.
# capture.run.id is expected but not required: builds before it was added wrote capture spans without it,
# and those runs are grouped by rig and time instead (see infer_rig_runs).
SPANS: dict[str, SpanSpec] = {
    "capture.frame": SpanSpec(
        {
            "capture.rig.id": _text,
            "capture.frame.index": _integer,
            "capture.frame.outcome": _text,
        },
        _build_frame,
    ),
    "capture.run.started": SpanSpec(
        {
            "capture.rig.id": _text,
            "capture.exposure.seconds": _number,
            "capture.run.repeat": _flag,
            "capture.run.saveFrames": _flag,
        },
        _build_run_started,
    ),
    "capture.run.ended": SpanSpec(
        {
            "capture.rig.id": _text,
            "capture.run.phase": _text,
            "capture.run.completed": _integer,
            "capture.run.lost": _integer,
            "capture.run.saved": _integer,
        },
        _build_run_ended,
    ),
    "cria.observation.interrupted": SpanSpec({"cria.device.id": _text}, _build_marker(False)),
    "cria.observation.recovered": SpanSpec({"cria.device.id": _text}, _build_marker(True)),
}
KNOWN_CAPTURE_SPANS = ("capture.frame", "capture.run.started", "capture.run.ended")
OBSERVATION_PREFIX = "cria.observation."


def _is_discovery_timeout(name: str, attrs: dict, obj: dict) -> bool:
    if not name.startswith("alpaca."):
        return False
    path = attrs.get("url.path")
    if "/management/" not in (path if _text(path) else name):
        return False
    messages = [obj.get("status", {}).get("message") if isinstance(obj.get("status"), dict) else None]
    events = obj.get("events")
    for event in events if isinstance(events, list) else []:
        event_attrs = event.get("attributes") if isinstance(event, dict) else None
        if isinstance(event_attrs, dict):
            messages.append(event_attrs.get("exception.message"))
    return any(_text(message) and "timed out" in message for message in messages)


def parse_span(line: bytes) -> Span | Rejected | Unparseable:
    try:
        obj = json.loads(line)
    except ValueError:
        return Unparseable()
    if not isinstance(obj, dict):
        return Unparseable()
    name, span_id = obj.get("name"), obj.get("spanId")
    if not _text(name) or not _text(span_id):
        return Unparseable()
    try:
        start = parse_time(obj["startTime"])
        end = parse_time(obj.get("endTime", obj["startTime"]))
    except (KeyError, TypeError, ValueError):
        return Unparseable()

    attrs = obj.get("attributes")
    attrs = attrs if isinstance(attrs, dict) else {}
    status = obj.get("status")
    is_error = isinstance(status, dict) and status.get("code") == OTEL_STATUS_ERROR
    duration = obj.get("durationMs")
    base = {
        "span_id": span_id,
        "start": start,
        "end": end,
        "duration_ms": float(duration) if _number(duration) else (end - start).total_seconds() * 1000,
    }

    spec = SPANS.get(name)
    record = None
    if spec:
        missing = tuple(key for key, valid in spec.required.items() if not valid(attrs.get(key)))
        if missing:
            return Rejected(name, missing)
        record = spec.build(base, attrs)

    device = attrs.get("cria.device.id") if name.startswith(OBSERVATION_PREFIX) else None
    return Span(
        name=name,
        span_id=span_id,
        start=start,
        is_error=is_error,
        discovery_timeout=is_error and _is_discovery_timeout(name, attrs, obj),
        device=device if _text(device) else None,
        record=record,
    )


@dataclass
class FileReport:
    path: str
    bytes: int = 0
    modified: datetime | None = None
    lines: int = 0
    spans: int = 0
    unparseable: int = 0
    torn_tail: bool = False
    rejected: int = 0
    first: datetime | None = None
    last: datetime | None = None


@dataclass
class Collected:
    window: Window
    files: list[FileReport] = field(default_factory=list)
    seen: set[str] = field(default_factory=set)
    duplicates: int = 0
    first_span: datetime | None = None
    last_span: datetime | None = None
    run_starts: list[RunStarted] = field(default_factory=list)
    run_ends: list[RunEnded] = field(default_factory=list)
    frames: list[Frame] = field(default_factory=list)
    without_run_id: Counter = field(default_factory=Counter)
    markers: list[DeviceMarker] = field(default_factory=list)
    span_names: Counter = field(default_factory=Counter)
    name_range: dict[str, tuple[datetime, datetime]] = field(default_factory=dict)
    name_devices: defaultdict = field(default_factory=lambda: defaultdict(Counter))
    rejected: Counter = field(default_factory=Counter)
    errors: defaultdict = field(default_factory=lambda: defaultdict(Counter))
    discovery_timeouts: int = 0

    def add(self, parsed: Span | Rejected | Unparseable, file: FileReport, torn: bool) -> None:
        if isinstance(parsed, Unparseable):
            if torn:
                file.torn_tail = True
            else:
                file.unparseable += 1
            return
        if isinstance(parsed, Rejected):
            file.rejected += 1
            for key in parsed.missing:
                self.rejected[(parsed.name, key)] += 1
            return
        if parsed.span_id in self.seen:
            self.duplicates += 1
            return
        self.seen.add(parsed.span_id)
        file.spans += 1
        file.first = parsed.start if file.first is None else min(file.first, parsed.start)
        file.last = parsed.start if file.last is None else max(file.last, parsed.start)
        self.first_span = parsed.start if self.first_span is None else min(self.first_span, parsed.start)
        self.last_span = parsed.start if self.last_span is None else max(self.last_span, parsed.start)

        record = parsed.record
        if isinstance(record, RunStarted):
            self.run_starts.append(record)
        elif isinstance(record, RunEnded):
            self.run_ends.append(record)
        elif isinstance(record, Frame):
            self.frames.append(record)
        if isinstance(record, (Frame, RunStarted, RunEnded)) and record.run_id is None:
            self.without_run_id[parsed.name] += 1

        if not self.window.contains(parsed.start):
            return

        self.span_names[parsed.name] += 1
        seen_range = self.name_range.get(parsed.name)
        self.name_range[parsed.name] = (
            (parsed.start, parsed.start)
            if seen_range is None
            else (min(seen_range[0], parsed.start), max(seen_range[1], parsed.start))
        )
        if parsed.device:
            self.name_devices[parsed.name][parsed.device] += 1
        if isinstance(record, DeviceMarker):
            self.markers.append(record)
        if parsed.discovery_timeout:
            self.discovery_timeouts += 1
        elif parsed.is_error:
            self.errors[error_group(parsed.name)][parsed.name] += 1


def error_group(name: str) -> str:
    if name.startswith("capture."):
        return "capture"
    if name.startswith("alpaca."):
        return "alpaca"
    return "other"


def read_file(collected: Collected, path: str) -> None:
    info = os.stat(path)
    report = FileReport(
        path=path,
        bytes=info.st_size,
        modified=datetime.fromtimestamp(info.st_mtime, timezone.utc),
    )
    collected.files.append(report)
    with open(path, "rb") as stream:
        for raw in stream:
            if not raw.strip():
                continue
            report.lines += 1
            collected.add(parse_span(raw), report, torn=not raw.endswith(b"\n"))


def nearest_rank(ordered: list[float], percent: int) -> float:
    return ordered[max(1, -(-percent * len(ordered) // 100)) - 1]


def stat(samples: list[float]) -> dict:
    if not samples:
        return {"n": 0, "min": None, "p50": None, "p95": None, "max": None}
    ordered = sorted(samples)
    return {
        "n": len(ordered),
        "min": round(ordered[0], 3),
        "p50": round(nearest_rank(ordered, 50), 3),
        "p95": round(nearest_rank(ordered, 95), 3),
        "max": round(ordered[-1], 3),
    }


def timing_samples(frames: list[Frame]) -> dict[str, list[float]]:
    completed = sorted((f for f in frames if f.outcome in COMPLETED), key=lambda f: (f.end, f.span_id))
    saved = [f for f in completed if f.outcome is FrameOutcome.SAVED]
    intervals = [
        (after.end - before.end).total_seconds() * 1000
        for before, after in zip(saved, saved[1:])
        if after.index == before.index + 1
    ]

    def column(read: Callable[[Frame], float | None]) -> list[float]:
        return [v for v in map(read, completed) if v is not None]

    return {
        "frameMs": column(lambda f: f.duration_ms),
        "acquireMs": column(lambda f: f.acquire_ms),
        "overheadMs": column(lambda f: f.overhead_ms),
        "processMs": column(lambda f: f.process_ms),
        "saveMs": column(lambda f: f.save_ms),
        "intervalMs": intervals,
    }


@dataclass
class RunDraft:
    run_id: str
    inferred: bool
    rig_id: str
    started: RunStarted | None = None
    ended: RunEnded | None = None
    frames: list[Frame] = field(default_factory=list)


def infer_rig_runs(
    rig: str, starts: list[RunStarted], ends: list[RunEnded], frames: list[Frame]
) -> list[RunDraft]:
    """Builds before capture.run.id wrote run events and frames without it: a run is a started event
    to the next ended event on the same rig, and a frame belongs to the run it began inside."""
    segments: list[list] = []
    events = sorted([(s.at, 0, s) for s in starts] + [(e.at, 1, e) for e in ends], key=lambda x: x[:2])
    for _, kind, event in events:
        if kind == 0:
            segments.append([event, None])
        elif segments and segments[-1][1] is None:
            segments[-1][1] = event
        else:
            segments.append([None, event])

    drafts = [RunDraft(f"inferred:{rig}:{n}", True, rig, s, e) for n, (s, e) in enumerate(segments, 1)]
    unattributed = RunDraft(f"inferred:{rig}:unattributed", True, rig)
    earliest = datetime.min.replace(tzinfo=timezone.utc)
    latest = datetime.max.replace(tzinfo=timezone.utc)
    for frame in sorted(frames, key=lambda f: (f.start, f.span_id)):
        for n, (started, ended) in enumerate(segments):
            lower = started.at if started else (segments[n - 1][1].at if n and segments[n - 1][1] else earliest)
            upper = ended.at if ended else (segments[n + 1][0].at if n + 1 < len(segments) and segments[n + 1][0] else latest)
            if lower <= frame.start <= upper:
                drafts[n].frames.append(frame)
                break
        else:
            unattributed.frames.append(frame)
    return drafts + ([unattributed] if unattributed.frames else [])


def group_runs(collected: Collected) -> list[RunDraft]:
    drafts: dict[str, RunDraft] = {}

    def explicit(run_id: str, rig_id: str) -> RunDraft:
        return drafts.setdefault(run_id, RunDraft(run_id, False, rig_id))

    for started in collected.run_starts:
        if started.run_id:
            draft = explicit(started.run_id, started.rig_id)
            draft.started = draft.started or started
    for ended in collected.run_ends:
        if ended.run_id:
            draft = explicit(ended.run_id, ended.rig_id)
            draft.ended = draft.ended or ended
    for frame in collected.frames:
        if frame.run_id:
            explicit(frame.run_id, frame.rig_id).frames.append(frame)

    rigs = {x.rig_id for x in (*collected.run_starts, *collected.run_ends, *collected.frames) if x.run_id is None}
    inferred = []
    for rig in sorted(rigs):
        inferred += infer_rig_runs(
            rig,
            [x for x in collected.run_starts if x.run_id is None and x.rig_id == rig],
            [x for x in collected.run_ends if x.run_id is None and x.rig_id == rig],
            [x for x in collected.frames if x.run_id is None and x.rig_id == rig],
        )
    return [*drafts.values(), *inferred]


def build_runs(collected: Collected) -> list[Run]:
    window = collected.window
    runs = []
    for draft in group_runs(collected):
        inside = tuple(sorted((f for f in draft.frames if window.contains(f.start)), key=lambda f: (f.start, f.span_id)))
        touched = (
            inside
            or (draft.started and window.contains(draft.started.at))
            or (draft.ended and window.contains(draft.ended.at))
        )
        if touched:
            runs.append(Run(draft.run_id, draft.rig_id, draft.inferred, draft.started, draft.ended,
                            inside, len(draft.frames) - len(inside)))
    return sorted(runs, key=lambda r: (run_first_moment(r), r.run_id))


def run_first_moment(run: Run) -> datetime:
    if run.started:
        return run.started.at
    if run.frames:
        return run.frames[0].start
    return run.ended.at  # type: ignore[union-attr]


def outcome_counts(frames: list[Frame] | tuple[Frame, ...]) -> Counter:
    return Counter(f.outcome_name for f in frames)


def outcomes_block(counts: Counter) -> dict[str, int]:
    block = {o.value: counts.get(o.value, 0) for o in FrameOutcome}
    block.update({name: n for name, n in counts.items() if name not in block})
    return block


def not_saved_block(counts: Counter) -> dict:
    by_name = {name: n for name, n in outcomes_block(counts).items() if name != FrameOutcome.SAVED.value}
    return {"total": sum(by_name.values()), "byName": by_name}


def completed_count(counts: Counter) -> int:
    return sum(counts.get(o.value, 0) for o in COMPLETED)


def retries_block(frames: list[Frame] | tuple[Frame, ...]) -> dict:
    return {
        "frames": sum(1 for f in frames if f.retry_count > 0),
        "count": sum(f.retry_count for f in frames),
        "ms": round(sum(f.retry_ms for f in frames), 3),
    }


def match_interruptions(markers: list[DeviceMarker]) -> tuple[list[Interruption], Counter, Counter]:
    open_by_device: dict[str, DeviceMarker] = {}
    done: list[Interruption] = []
    orphans: Counter = Counter()
    repeated: Counter = Counter()
    for marker in sorted(markers, key=lambda m: (m.at, m.span_id)):
        opened = open_by_device.get(marker.device)
        if not marker.recovered:
            if opened:
                repeated[marker.device] += 1
            else:
                open_by_device[marker.device] = marker
        elif opened:
            span_ms = (marker.at - opened.at).total_seconds() * 1000
            done.append(
                Interruption(
                    marker.device, opened.at, opened.reason, marker.at,
                    marker.interrupted_ms if marker.interrupted_ms is not None else span_ms,
                )
            )
            del open_by_device[marker.device]
        else:
            orphans[marker.device] += 1
    done.extend(Interruption(m.device, m.at, m.reason, None, None) for m in open_by_device.values())
    return done, orphans, repeated


def interruptions_block(markers: list[DeviceMarker]) -> dict:
    matched, orphans, repeated = match_interruptions(markers)
    devices = {i.device for i in matched} | set(orphans)
    by_device = {}
    for device in sorted(devices):
        mine = [i for i in matched if i.device == device]
        recovered = [i for i in mine if i.recovered is not None]
        open_ones = [i for i in mine if i.recovered is None]
        by_device[device] = {
            "count": len(mine),
            "recovered": len(recovered),
            "open": len(open_ones),
            "openSince": [iso(i.started) for i in open_ones],
            "totalMs": round(sum(i.ms or 0.0 for i in recovered), 3),
            "reasons": dict(Counter(i.reason or "(none recorded)" for i in mine)),
            "recoveredWithoutInterrupt": orphans[device],
            "interruptedWhileOpen": repeated[device],
        }
    return {
        "total": len(matched),
        "open": sum(1 for i in matched if i.recovered is None),
        "byDevice": by_device,
    }


def observation_block(collected: Collected) -> dict:
    names = {n: c for n, c in collected.span_names.items() if n.startswith(OBSERVATION_PREFIX)}
    interrupted = names.get("cria.observation.interrupted", 0)
    refreshing = names.get("cria.observation.refreshing", 0)
    refreshed = names.get("cria.observation.refreshed", 0)
    if interrupted and not (refreshing or refreshed):
        epoch = "interrupted-only"
    elif interrupted and (refreshing or refreshed):
        first_interrupt = collected.name_range["cria.observation.interrupted"][0]
        first_refresh = min(
            collected.name_range[n][0]
            for n in ("cria.observation.refreshing", "cria.observation.refreshed")
            if n in collected.name_range
        )
        epoch = "mixed" if first_interrupt < first_refresh else "refresh-spans"
    elif refreshing or refreshed:
        epoch = "refresh-spans"
    else:
        epoch = "none"
    return {
        "epoch": epoch,
        "spans": {
            name: {"count": count, "byDevice": dict(sorted(collected.name_devices[name].items()))}
            for name, count in sorted(names.items())
        },
    }


def definitions() -> dict[str, str]:
    return {
        "attempted": "capture.frame spans whose startTime is in the window, grouped by capture.run.id",
        "completed": "attempted frames with outcome saved, unsaved or save-failed: the frames whose image arrived. "
        "This is what capture.run.ended.completed counts in Vela's controller, so stopped, lost, failed and "
        "uncertain frames are not completed",
        "saved": "capture.frame outcome saved; compared with capture.run.ended saved, which also counts "
        "images kept by hand",
        "notSaved": "every attempted frame that is not saved, by outcome name",
        "interruptions": "cria.observation.interrupted matched to the next recovered of the same cria.device.id; "
        "an interruption with no recovered in the window is open",
        "readRetries": "capture.read.retrying.count summed over attempted frames",
        "timing": TIMING_BASIS,
        "percentiles": PERCENTILE_METHOD,
    }


def run_block(run: Run) -> tuple[dict, list[dict]]:
    counts = outcome_counts(run.frames)
    completed = completed_count(counts)
    saved = counts.get(FrameOutcome.SAVED.value, 0)
    lost = counts.get(FrameOutcome.LOST.value, 0)

    incomplete = []
    if run.started is None:
        incomplete.append("start-marker-missing")
    if run.ended is None:
        incomplete.append("end-marker-missing")
    if run.frames_outside_window:
        incomplete.append("frames-outside-window")

    ended = run.ended
    runEnded = agrees = None
    if ended:
        runEnded = {"completed": ended.completed, "lost": ended.lost, "saved": ended.saved}
        if not run.frames_outside_window:
            agrees = {
                "completed": ended.completed == completed,
                "lost": ended.lost == lost,
                "saved": ended.saved == saved,
            }

    warnings = []
    if run.ended is None:
        warnings.append({
            "code": "run-open",
            "runId": run.run_id,
            "message": "no capture.run.ended in the window: the run is still going, or the server stopped "
            "before writing it. Counts for this run are provisional.",
        })
    if run.started is None:
        warnings.append({
            "code": "run-start-missing",
            "runId": run.run_id,
            "message": "no capture.run.started found: the start was rotated out, or the run began before tracing.",
        })
    if agrees and not all(agrees.values()):
        warnings.append({
            "code": "run-ended-disagrees",
            "runId": run.run_id,
            "fields": sorted(k for k, ok in agrees.items() if not ok),
            "spans": {"completed": completed, "lost": lost, "saved": saved},
            "runEnded": runEnded,
            "message": "capture.run.ended disagrees with the frame spans. A saved difference can be images "
            "kept by hand; otherwise frames are missing from the trace.",
        })

    block = {
        "runId": run.run_id,
        "runIdSource": "inferred" if run.inferred else "trace",
        "rigId": run.rig_id,
        "startedAt": iso(run.started.at) if run.started else None,
        "endedAt": iso(ended.at) if ended else None,
        "phase": ended.phase if ended else None,
        "error": ended.error if ended else None,
        "exposureSeconds": run.started.exposure_seconds if run.started else None,
        "repeat": run.started.repeat if run.started else None,
        "saveFrames": run.started.save_frames if run.started else None,
        "framesAttempted": len(run.frames),
        "framesCompleted": completed,
        "framesSaved": saved,
        "outcomes": outcomes_block(counts),
        "notSaved": not_saved_block(counts),
        "runEnded": runEnded,
        "agrees": agrees,
        "incomplete": incomplete,
        "timing": {name: stat(values) for name, values in timing_samples(list(run.frames)).items()},
        "readRetries": retries_block(run.frames),
    }
    return block, warnings


def read_journal(path: str, window: Window) -> dict:
    per_run: dict[str, Counter] = defaultdict(Counter)
    attempts: set[tuple[str, int]] = set()
    lines = skipped = 0
    with open(path, "rb") as stream:
        for raw in stream:
            if not raw.strip():
                continue
            lines += 1
            try:
                row = json.loads(raw)
                if row["version"] != 1:
                    raise ValueError("version")
                run_id, attempt, outcome = row["runId"], row["attempt"], row["outcome"]
                started = parse_time(row["startedAt"])
                if not (_text(run_id) and _integer(attempt) and _text(outcome)):
                    raise ValueError("types")
            except (ValueError, KeyError, TypeError):
                skipped += 1
                continue
            if (run_id, attempt) in attempts or not window.contains(started):
                continue
            attempts.add((run_id, attempt))
            per_run[run_id][outcome] += 1
    return {"lines": lines, "skippedLines": skipped, "perRun": per_run}


def journal_block(path: str, journal: dict, runs: list[Run]) -> dict:
    trace_totals = outcome_counts([f for r in runs for f in r.frames])
    journal_totals = Counter()
    for counts in journal["perRun"].values():
        journal_totals.update(counts)

    per_run_possible = not any(r.inferred for r in runs)
    rows = []
    if per_run_possible:
        trace = {r.run_id: outcome_counts(r.frames) for r in runs if r.frames}
        for run_id in sorted(set(trace) | set(journal["perRun"])):
            mine, theirs = trace.get(run_id, Counter()), journal["perRun"].get(run_id, Counter())
            rows.append({"runId": run_id, "trace": sum(mine.values()), "journal": sum(theirs.values()),
                         "agrees": mine == theirs})
    return {
        "path": path,
        "lines": journal["lines"],
        "skippedLines": journal["skippedLines"],
        "attemptsInJournal": sum(journal_totals.values()),
        "attemptsInTrace": sum(trace_totals.values()),
        "difference": sum(journal_totals.values()) - sum(trace_totals.values()),
        "agrees": trace_totals == journal_totals and all(r["agrees"] for r in rows),
        "outcomes": {"trace": outcomes_block(trace_totals), "journal": outcomes_block(journal_totals)},
        "runs": rows if per_run_possible else "unavailable: trace runs have no capture.run.id, so only totals are compared",
    }


def saved_images_block(root: str, window: Window) -> dict:
    total = inside = 0
    for folder, _, names in os.walk(root):
        if "original.fits" not in names:
            continue
        total += 1
        modified = datetime.fromtimestamp(os.stat(os.path.join(folder, "original.fits")).st_mtime, timezone.utc)
        if window.contains(modified):
            inside += 1
    return {
        "path": root,
        "kind": "filesystem count, advisory",
        "basis": "folders holding an original.fits whose modification time is in the window; other files are not counted",
        "originalFits": inside,
        "originalFitsAnyTime": total,
    }


def parse_window_time(raw: str, flag: str) -> datetime:
    try:
        return parse_time(raw)
    except ValueError:
        raise UsageError(f"{flag} is not an ISO 8601 time: {raw!r}")


class _Parser(argparse.ArgumentParser):
    def error(self, message: str):
        raise UsageError(message)


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = _Parser(
        prog="trace_report.py",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
        allow_abbrev=False,
    )
    parser.add_argument("paths", nargs="+", metavar="PATH")
    parser.add_argument("--since")
    parser.add_argument("--until")
    parser.add_argument("--frames", metavar="FRAMES.jsonl")
    parser.add_argument("--saved-images", metavar="DIR")
    args = parser.parse_args(argv)
    args.window = Window(
        parse_window_time(args.since, "--since") if args.since else None,
        parse_window_time(args.until, "--until") if args.until else None,
    )
    if args.window.since and args.window.until and args.window.since >= args.window.until:
        raise UsageError("--since must be earlier than --until")
    return args


def resolve_inputs(paths: list[str]) -> tuple[list[str], list[dict]]:
    if len(paths) == 1:
        files = [paths[0]] + [
            f"{paths[0]}.{n}" for n in ROTATED_SUFFIXES if os.path.exists(f"{paths[0]}.{n}")
        ]
    else:
        files = list(dict.fromkeys(paths))

    for path in files:
        if not os.path.exists(path):
            raise Refused("no-readable-trace", f"no such file: {path}")
        if not os.path.isfile(path):
            raise Refused("no-readable-trace", f"not a file: {path}")
        if not os.access(path, os.R_OK):
            raise Refused("no-readable-trace", f"not readable: {path}")

    warnings = []
    if len(paths) > 1:
        unread = [
            f"{p}.{n}" for p in files for n in ROTATED_SUFFIXES
            if os.path.exists(f"{p}.{n}") and f"{p}.{n}" not in files
        ]
        if unread:
            warnings.append({
                "code": "rotated-files-unread",
                "files": unread,
                "message": "rotated files exist beside a file you named but were not read, so counts can be "
                "short. Pass the single base path to read the whole set.",
            })
    return files, warnings


def input_warnings(collected: Collected, window: Window, now: datetime) -> tuple[list[dict], list[str]]:
    warnings = [{
        "code": "open-spans-absent",
        "message": "a span is written only when it ends, so unfinished spans (a frame or run still going, "
        "or lost in a crash) are absent. Counts from a file still being written are provisional.",
    }]
    live = [
        f.path for f in collected.files
        if f.modified and (now - f.modified).total_seconds() < LIVE_FILE_SECONDS
    ]
    if live:
        warnings.append({
            "code": "live-file",
            "files": live,
            "message": f"modified within the last {LIVE_FILE_SECONDS}s: probably being written, so counts are provisional.",
        })
    if window.since and collected.first_span and window.since < collected.first_span:
        warnings.append({
            "code": "since-before-oldest-span",
            "oldestSpan": iso(collected.first_span),
            "message": "--since is earlier than the oldest retained span. Rotation may have dropped the start, "
            "or the server had not started yet.",
        })
    for file in collected.files:
        if file.torn_tail:
            warnings.append({"code": "torn-tail", "file": file.path,
                             "message": "the last line was cut off mid-write and was dropped."})
        if file.unparseable:
            warnings.append({"code": "unparseable-lines", "file": file.path, "count": file.unparseable,
                             "message": "lines that are not a span were dropped."})
    if collected.duplicates:
        warnings.append({"code": "duplicate-spans", "count": collected.duplicates,
                         "message": "spans with an already-seen spanId were dropped (rotation overlap or a copied file)."})
    return warnings, live


def capture_warnings(collected: Collected, frames: list[Frame]) -> list[dict]:
    warnings = []
    if collected.rejected:
        warnings.append({
            "code": "capture-line-missing-keys",
            "lines": [{"name": n, "key": k, "count": c} for (n, k), c in sorted(collected.rejected.items())],
            "message": "known spans missing a required attribute (or holding the wrong type) were dropped. "
            "The writer probably changed; trace lines carry no version.",
        })
    unknown_outcomes = Counter(f.outcome_name for f in frames if f.outcome is None)
    if unknown_outcomes:
        warnings.append({
            "code": "unknown-frame-outcome",
            "outcomes": dict(unknown_outcomes),
            "message": "capture.frame outcomes this script does not know. They count as attempted, never as "
            "completed or saved.",
        })
    capture_names = {n for n in collected.span_names if n.startswith("capture.")}
    unknown_spans = sorted(capture_names - set(KNOWN_CAPTURE_SPANS))
    if unknown_spans:
        warnings.append({"code": "unknown-capture-span", "names": unknown_spans,
                         "message": "capture.* spans this script does not read."})
    absent = [n for n in KNOWN_CAPTURE_SPANS if n not in capture_names] if capture_names else []
    if absent:
        warnings.append({"code": "known-span-missing", "names": absent,
                         "message": "capture.* activity is present but these known spans never appear in the window."})
    if collected.without_run_id:
        warnings.append({
            "code": "capture-run-id-missing",
            "lines": dict(sorted(collected.without_run_id.items())),
            "message": "capture spans without capture.run.id (a build before it was added). Those runs are grouped "
            "by rig and time between run.started and run.ended: an inference, shown as runIdSource inferred.",
        })
    return warnings


def observation_warnings(collected: Collected, observation: dict) -> list[dict]:
    warnings = []
    if observation["epoch"] == "interrupted-only":
        warnings.append({
            "code": "interruptions-may-include-refreshes",
            "message": "no cria.observation.refreshing/refreshed spans in the window. Builds before them reported "
            "a normal refresh as interrupted, so these counts can include refreshes. Do not compare them with a "
            "window that has refresh spans.",
        })
    if observation["epoch"] == "mixed":
        warnings.append({
            "code": "observation-epochs-mixed",
            "message": "the window spans the change that added refreshing/refreshed spans. Interruption counts "
            "before and after it mean different things.",
        })
    refreshing = collected.span_names.get("cria.observation.refreshing", 0)
    refreshed = collected.span_names.get("cria.observation.refreshed", 0)
    if refreshing != refreshed:
        warnings.append({
            "code": "refresh-spans-unequal",
            "refreshing": refreshing,
            "refreshed": refreshed,
            "message": "refreshing and refreshed counts differ: spans still open or lost in a crash.",
        })
    return warnings


def build_report(args: argparse.Namespace, now: datetime) -> dict:
    files, warnings = resolve_inputs(args.paths)
    collected = Collected(window=args.window)
    for path in files:
        read_file(collected, path)

    if sum(f.spans for f in collected.files) == 0:
        raise Refused("not-a-trace", "no line in the given files parsed as a span: not a Vela trace, or empty")

    runs = build_runs(collected)
    window_frames = [f for r in runs for f in r.frames]
    observation = observation_block(collected)
    gathered, live = input_warnings(collected, args.window, now)
    warnings += gathered + capture_warnings(collected, window_frames) + observation_warnings(collected, observation)

    run_blocks = []
    for run in runs:
        block, run_warnings = run_block(run)
        run_blocks.append(block)
        warnings.extend(run_warnings)

    frames = window_frames
    counts = outcome_counts(frames)
    pooled: dict[str, list[float]] = defaultdict(list)
    for run in runs:
        for name, values in timing_samples(list(run.frames)).items():
            pooled[name].extend(values)
    if not run_blocks:
        warnings.append({"code": "no-capture-activity",
                         "message": "no capture runs or frames in the window."})

    starts = [r.started.at if r.started else r.frames[0].start for r in runs if r.started or r.frames]
    stops = [r.ended.at if r.ended else r.frames[-1].end for r in runs if r.ended or r.frames]
    run_events_only = bool(runs) and all(r.started and r.ended for r in runs)

    report = {
        "schema": SCHEMA,
        "generatedAt": iso(now),
        "provisional": bool(live) or any(b["endedAt"] is None for b in run_blocks),
        "window": {
            "requestedSince": iso(args.window.since),
            "requestedUntil": iso(args.window.until),
            "actualStart": iso(min(starts)) if starts else None,
            "actualEnd": iso(max(stops)) if stops else None,
            "actualBasis": "run events" if run_events_only else "run events where present, else frame spans",
        },
        "files": [
            {
                "path": f.path, "bytes": f.bytes, "modifiedAt": iso(f.modified), "lines": f.lines,
                "spans": f.spans, "unparseableLines": f.unparseable, "tornTail": f.torn_tail,
                "rejectedLines": f.rejected, "firstSpan": iso(f.first), "lastSpan": iso(f.last),
            }
            for f in collected.files
        ],
        "coverage": {
            "firstSpan": iso(collected.first_span),
            "lastSpan": iso(collected.last_span),
            "spansRead": sum(f.spans for f in collected.files),
            "duplicatesDropped": collected.duplicates,
        },
        "definitions": definitions(),
        "percentileMethod": PERCENTILE_METHOD,
        "totals": {
            "runs": len(runs),
            "framesAttempted": len(frames),
            "framesCompleted": completed_count(counts),
            "framesSaved": counts.get(FrameOutcome.SAVED.value, 0),
            "outcomes": outcomes_block(counts),
            "notSaved": not_saved_block(counts),
            "readRetries": retries_block(frames),
            "timing": {name: stat(values) for name, values in pooled.items()},
        },
        "runs": run_blocks,
        "interruptions": interruptions_block(collected.markers),
        "observation": observation,
        "errors": {
            "alpacaDiscoveryTimeouts": collected.discovery_timeouts,
            "capture": dict(sorted(collected.errors["capture"].items())),
            "alpaca": dict(sorted(collected.errors["alpaca"].items())),
            "other": dict(sorted(collected.errors["other"].items())),
        },
    }

    if args.frames:
        journal = journal_block(args.frames, read_journal(args.frames, args.window), runs)
        report["framesJournal"] = journal
        if not journal["agrees"]:
            warnings.append({
                "code": "frames-journal-differs",
                "difference": journal["difference"],
                "message": "the frame records journal and the trace disagree on attempts. The journal is not "
                "rotated, so the trace may have lost frames to rotation or a crash.",
            })
    if args.saved_images:
        report["savedImages"] = saved_images_block(args.saved_images, args.window)

    report["warnings"] = warnings
    return report


def error_document(code: str, message: str) -> dict:
    return {"schema": SCHEMA, "error": {"code": code, "message": message}}


def check_named_inputs(args: argparse.Namespace) -> None:
    if args.frames and not os.path.isfile(args.frames):
        raise Refused("no-readable-frames", f"no such frames journal: {args.frames}")
    if args.saved_images and not os.path.isdir(args.saved_images):
        raise Refused("no-readable-saved-images", f"not a directory: {args.saved_images}")


def run(argv: list[str], now: datetime | None = None) -> tuple[int, dict]:
    try:
        args = parse_args(argv)
    except UsageError as problem:
        return 1, error_document("bad-arguments", str(problem))
    try:
        check_named_inputs(args)
        return 0, build_report(args, now or datetime.now(timezone.utc))
    except Refused as refusal:
        return 2, error_document(refusal.code, str(refusal))
    except OSError as failure:
        return 3, error_document("environment", f"{type(failure).__name__}: {failure}")


def main() -> int:
    code, document = run(sys.argv[1:])
    json.dump(document, sys.stdout, indent=2)
    sys.stdout.write("\n")
    return code


if __name__ == "__main__":
    sys.exit(main())
