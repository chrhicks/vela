import itertools
import json
import os
import subprocess
import sys
import tempfile
import tracemalloc
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

import trace_report

SCRIPT = Path(trace_report.__file__)
T0 = datetime(2026, 1, 5, 1, 0, 0, tzinfo=timezone.utc)
LONG_AGO = datetime(2026, 1, 6, tzinfo=timezone.utc).timestamp()
NOW = datetime(2026, 1, 7, tzinfo=timezone.utc)
ids = itertools.count(1)


def stamp(moment):
    return moment.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def at(seconds):
    return T0 + timedelta(seconds=seconds)


def span(name, start, duration_ms=0, attrs=None, error=False, events=None, span_id=None):
    end = start + timedelta(milliseconds=duration_ms)
    return {
        "type": "span",
        "name": name,
        "traceId": "t" * 32,
        "spanId": span_id or f"{next(ids):016x}",
        "startTime": stamp(start),
        "endTime": stamp(end),
        "durationMs": duration_ms,
        "status": {"code": 2 if error else 0},
        "attributes": attrs or {},
        "events": events or [],
    }


def run_started(run_id, start, exposure=10):
    return span("capture.run.started", start, attrs={
        "capture.run.id": run_id, "capture.rig.id": "rig-a", "capture.exposure.seconds": exposure,
        "capture.run.repeat": True, "capture.run.saveFrames": True,
    })


def run_ended(run_id, start, completed, saved, lost=0, phase="stopped"):
    return span("capture.run.ended", start, attrs={
        "capture.run.id": run_id, "capture.rig.id": "rig-a", "capture.run.phase": phase,
        "capture.run.completed": completed, "capture.run.lost": lost, "capture.run.saved": saved,
    })


def frame(run_id, index, start, duration_ms, outcome="saved", extra=None):
    attrs = {
        "capture.run.id": run_id, "capture.rig.id": "rig-a", "capture.frame.index": index,
        "capture.frame.outcome": outcome,
    }
    attrs.update(extra or {})
    return span("capture.frame", start, duration_ms, attrs, error=outcome in ("lost", "failed"))


def timed_frame(run_id, index, start, duration_ms, outcome="saved", extra=None):
    acquire = duration_ms - 800
    timing = {
        "capture.acquire.ms": acquire, "capture.overhead.ms": acquire - 10000,
        "capture.process.ms": 500, "capture.save.ms": 300,
    }
    timing.update(extra or {})
    return frame(run_id, index, start, duration_ms, outcome, timing)


def device_marker(name, start, device, **attrs):
    return span(name, start, attrs={"cria.device.id": device, **attrs})


def night(run_id="run-1", saved=30, stopped=True, start=0):
    """30 saved frames 12 s apart, durations 11100 to 14000 ms, then one stopped frame."""
    spans = [run_started(run_id, at(start))]
    for i in range(1, saved + 1):
        end = start + 12 * i
        duration = 11000 + 100 * i
        spans.append(timed_frame(run_id, i, at(end) - timedelta(milliseconds=duration), duration))
    completed = saved
    if stopped:
        stop_end = at(start + 12 * saved + 3.69)
        spans.append(frame(run_id, saved + 1, stop_end - timedelta(milliseconds=5500), 5500, "stopped"))
    spans.append(run_ended(run_id, at(start + 12 * saved + 4), completed, saved))
    return spans


class TraceCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)

    def write(self, name, spans, torn=None, mtime=LONG_AGO, raw_lines=()):
        path = self.dir / name
        text = "".join(json.dumps(s) + "\n" for s in spans) + "".join(raw_lines)
        if torn:
            text += torn
        path.write_text(text)
        os.utime(path, (mtime, mtime))
        return path

    def report(self, *argv, expect=0):
        code, document = trace_report.run([str(a) for a in argv], now=NOW)
        self.assertEqual(code, expect, document)
        return document

    def warning_codes(self, document):
        return [w["code"] for w in document["warnings"]]


class CountsTest(TraceCase):
    def test_stopped_frame_makes_spans_exceed_completed_by_one(self):
        trace = self.write("observing.jsonl", night())
        report = self.report(trace)
        run = report["runs"][0]
        self.assertEqual(
            (run["framesAttempted"], run["framesCompleted"], run["framesSaved"]), (31, 30, 30)
        )
        self.assertEqual(run["notSaved"], {"total": 1, "byName": {
            "unsaved": 0, "lost": 0, "save-failed": 0, "stopped": 1, "uncertain": 0, "failed": 0}})
        self.assertEqual(run["agrees"], {"completed": True, "lost": True, "saved": True})
        self.assertEqual(report["totals"]["framesAttempted"], 31)

    def test_stopped_frame_is_excluded_from_timing(self):
        timing = self.report(self.write("observing.jsonl", night()))["runs"][0]["timing"]
        self.assertEqual(timing["frameMs"], {"n": 30, "min": 11100.0, "p50": 12500.0, "p95": 13900.0, "max": 14000.0})
        self.assertEqual(timing["overheadMs"]["n"], 30)
        self.assertEqual(timing["overheadMs"]["min"], 300.0)
        self.assertEqual(timing["intervalMs"], {"n": 29, "min": 12000.0, "p50": 12000.0, "p95": 12000.0, "max": 12000.0})

    def test_percentiles_are_nearest_rank(self):
        spans = [run_started("r", at(0))]
        spans += [timed_frame("r", i, at(20 * i), i * 1000) for i in range(1, 11)]
        report = self.report(self.write("observing.jsonl", spans))
        self.assertEqual(report["runs"][0]["timing"]["frameMs"],
                         {"n": 10, "min": 1000.0, "p50": 5000.0, "p95": 10000.0, "max": 10000.0})
        self.assertIn("nearest-rank", report["percentileMethod"])
        self.assertEqual(report["percentileMethod"], report["definitions"]["percentiles"])

    def test_intervals_skip_pairs_split_by_a_lost_frame(self):
        spans = [run_started("r", at(0)),
                 timed_frame("r", 1, at(0), 10000), timed_frame("r", 2, at(12), 10000),
                 frame("r", 3, at(24), 3000, "lost"), timed_frame("r", 4, at(36), 10000)]
        timing = self.report(self.write("observing.jsonl", spans))["runs"][0]["timing"]
        self.assertEqual(timing["intervalMs"]["n"], 1)
        self.assertEqual(timing["frameMs"]["n"], 3)

    def test_not_saved_names_every_outcome(self):
        spans = [run_started("r", at(0))]
        for i, outcome in enumerate(["saved", "unsaved", "lost", "save-failed", "uncertain", "failed", "stopped"], 1):
            spans.append(frame("r", i, at(20 * i), 10000, outcome))
        run = self.report(self.write("observing.jsonl", spans))["runs"][0]
        self.assertEqual(run["framesAttempted"], 7)
        self.assertEqual(run["framesCompleted"], 3)
        self.assertEqual(run["notSaved"]["total"], 6)
        self.assertEqual(run["notSaved"]["byName"], {"unsaved": 1, "lost": 1, "save-failed": 1,
                                                      "stopped": 1, "uncertain": 1, "failed": 1})

    def test_run_ended_saved_count_that_disagrees_is_flagged(self):
        spans = night()
        spans[-1] = run_ended("run-1", at(400), 30, 31)
        report = self.report(self.write("observing.jsonl", spans))
        self.assertEqual(report["runs"][0]["agrees"], {"completed": True, "lost": True, "saved": False})
        flagged = [w for w in report["warnings"] if w["code"] == "run-ended-disagrees"]
        self.assertEqual(flagged[0]["fields"], ["saved"])
        self.assertEqual(flagged[0]["spans"]["saved"], 30)

    def test_read_retries_are_summed(self):
        spans = [run_started("r", at(0)),
                 timed_frame("r", 1, at(0), 10000, extra={"capture.read.retrying.count": 3, "capture.read.retrying.ms": 1500}),
                 timed_frame("r", 2, at(20), 10000, extra={"capture.read.retrying.count": 2, "capture.read.retrying.ms": 500}),
                 timed_frame("r", 3, at(40), 10000)]
        retries = self.report(self.write("observing.jsonl", spans))["totals"]["readRetries"]
        self.assertEqual(retries, {"frames": 2, "count": 5, "ms": 2000.0})


class WindowTest(TraceCase):
    def test_actual_run_start_and_end_come_from_the_run_events(self):
        spans = night(start=3115)
        report = self.report(self.write("observing.jsonl", spans), "--since", "2026-01-05T00:00:00Z")
        window = report["window"]
        self.assertEqual(window["requestedSince"], "2026-01-05T00:00:00.000Z")
        self.assertEqual(window["actualStart"], "2026-01-05T01:51:55.000Z")
        self.assertEqual(window["actualEnd"], "2026-01-05T01:57:59.000Z")
        self.assertEqual(window["actualBasis"], "run events")

    def test_window_crops_frames_and_marks_the_run_partial(self):
        trace = self.write("observing.jsonl", night())
        report = self.report(trace, "--since", "2026-01-05T01:03:00Z", "--until", "2026-01-05T01:05:00Z")
        run = report["runs"][0]
        self.assertEqual(run["framesAttempted"], 10)
        self.assertEqual(run["incomplete"], ["frames-outside-window"])
        self.assertIsNone(run["agrees"])
        self.assertEqual(run["startedAt"], "2026-01-05T01:00:00.000Z")

    def test_since_before_oldest_span_warns(self):
        trace = self.write("observing.jsonl", night(start=600))
        early = self.report(trace, "--since", "2026-01-05T00:00:00Z")
        self.assertIn("since-before-oldest-span", self.warning_codes(early))
        self.assertEqual([w for w in early["warnings"] if w["code"] == "since-before-oldest-span"][0]["oldestSpan"],
                         "2026-01-05T01:10:00.000Z")
        inside = self.report(trace, "--since", "2026-01-05T01:10:00Z")
        self.assertNotIn("since-before-oldest-span", self.warning_codes(inside))

    def test_naive_time_is_utc(self):
        trace = self.write("observing.jsonl", night())
        report = self.report(trace, "--since", "2026-01-05T01:00:00")
        self.assertEqual(report["window"]["requestedSince"], "2026-01-05T01:00:00.000Z")


class RotationTest(TraceCase):
    def rotated_set(self):
        """One long run split over five files, three frames each, written oldest in .4."""
        spans = night(saved=14, stopped=True)
        frames = [s for s in spans if s["name"] == "capture.frame"]
        markers = [s for s in spans if s["name"] != "capture.frame"]
        chunks = [frames[i:i + 3] for i in range(0, 15, 3)]
        chunks[0] = [markers[0]] + chunks[0]
        chunks[-1] += [markers[1]]
        base = self.write("observing.jsonl", chunks[4])
        for n, chunk in zip((1, 2, 3, 4), (chunks[3], chunks[2], chunks[1], chunks[0])):
            self.write(f"observing.jsonl.{n}", chunk)
        return base

    def test_one_path_reads_the_whole_rotation_set(self):
        report = self.report(self.rotated_set())
        self.assertEqual(len(report["files"]), 5)
        self.assertEqual(report["runs"][0]["framesAttempted"], 15)
        self.assertEqual(report["runs"][0]["agrees"], {"completed": True, "lost": True, "saved": True})

    def test_tail_only_read_is_short_and_says_so(self):
        base = self.rotated_set()
        report = self.report(base, base.with_name("observing.jsonl.1"))
        self.assertEqual(len(report["files"]), 2)
        self.assertEqual(report["runs"][0]["framesAttempted"], 6)
        self.assertEqual(report["runs"][0]["incomplete"], ["start-marker-missing"])
        self.assertEqual(report["runs"][0]["agrees"]["completed"], False)
        self.assertIn("run-ended-disagrees", self.warning_codes(report))
        unread = [w for w in report["warnings"] if w["code"] == "rotated-files-unread"][0]["files"]
        self.assertEqual(len(unread), 3)
        self.assertEqual(self.report(base)["runs"][0]["framesAttempted"], 15)

    def test_file_order_does_not_matter(self):
        base = self.rotated_set()
        forward = self.report(base)["runs"][0]["timing"]
        shuffled = self.report(*[base.with_name(f"observing.jsonl.{n}") for n in (2, 4, 1, 3)], base)
        self.assertEqual(shuffled["runs"][0]["timing"], forward)
        self.assertEqual(forward["intervalMs"]["n"], 13)

    def test_overlap_between_files_is_deduped_by_span_id(self):
        spans = night(saved=4, stopped=False)
        base = self.write("observing.jsonl", spans)
        self.write("observing.jsonl.1", spans[:3])
        report = self.report(base)
        self.assertEqual(report["runs"][0]["framesAttempted"], 4)
        self.assertEqual(report["coverage"]["duplicatesDropped"], 3)
        self.assertEqual(report["coverage"]["spansRead"], len(spans))
        self.assertIn("duplicate-spans", self.warning_codes(report))


class LiveFileTest(TraceCase):
    def test_unclosed_run_on_a_live_file_is_provisional(self):
        spans = night(saved=5, stopped=False)[:-1]
        spans.append(device_marker("cria.observation.refreshing", at(1), "cam"))
        spans += [device_marker("cria.observation.refreshing", at(2 + i), "cam") for i in range(19)]
        spans += [device_marker("cria.observation.refreshed", at(2 + i), "cam") for i in range(18)]
        live = self.write("observing.jsonl", spans, mtime=NOW.timestamp() - 5)
        report = self.report(live)
        self.assertTrue(report["provisional"])
        codes = self.warning_codes(report)
        for expected in ("live-file", "open-spans-absent", "run-open", "refresh-spans-unequal"):
            self.assertIn(expected, codes)
        unequal = [w for w in report["warnings"] if w["code"] == "refresh-spans-unequal"][0]
        self.assertEqual((unequal["refreshing"], unequal["refreshed"]), (20, 18))
        self.assertIsNone(report["runs"][0]["endedAt"])

    def test_closed_old_file_is_not_provisional_but_still_says_open_spans_are_absent(self):
        report = self.report(self.write("observing.jsonl", night()))
        self.assertFalse(report["provisional"])
        self.assertIn("open-spans-absent", self.warning_codes(report))
        self.assertNotIn("live-file", self.warning_codes(report))


class DamageTest(TraceCase):
    def test_torn_last_line_is_dropped_and_counted(self):
        spans = night(saved=3, stopped=False)
        torn = json.dumps(frame("run-1", 4, at(60), 10000))[:90]
        report = self.report(self.write("observing.jsonl", spans, torn=torn))
        file = report["files"][0]
        self.assertTrue(file["tornTail"])
        self.assertEqual((file["lines"], file["spans"], file["unparseableLines"]), (6, 5, 0))
        self.assertEqual(report["runs"][0]["framesAttempted"], 3)
        self.assertIn("torn-tail", self.warning_codes(report))

    def test_other_unparseable_lines_are_dropped_and_counted(self):
        spans = night(saved=3, stopped=False)
        report = self.report(self.write("observing.jsonl", spans, raw_lines=["not json\n", "[1]\n"]))
        file = report["files"][0]
        self.assertEqual((file["unparseableLines"], file["tornTail"]), (2, False))
        self.assertEqual(report["runs"][0]["framesAttempted"], 3)

    def test_unknown_outcome_is_attempted_but_never_completed(self):
        spans = night(saved=3, stopped=False)
        spans.insert(-1, frame("run-1", 4, at(60), 9000, "mystery"))
        report = self.report(self.write("observing.jsonl", spans))
        run = report["runs"][0]
        self.assertEqual((run["framesAttempted"], run["framesCompleted"], run["framesSaved"]), (4, 3, 3))
        self.assertEqual(run["outcomes"]["mystery"], 1)
        warning = [w for w in report["warnings"] if w["code"] == "unknown-frame-outcome"][0]
        self.assertEqual(warning["outcomes"], {"mystery": 1})

    def test_capture_line_missing_keys_is_rejected_and_warned(self):
        spans = night(saved=3, stopped=False)
        broken = frame("run-1", 4, at(60), 9000)
        del broken["attributes"]["capture.run.id"]
        wrong_type = frame("run-1", 5, at(70), 9000)
        wrong_type["attributes"]["capture.frame.index"] = "five"
        report = self.report(self.write("observing.jsonl", spans + [broken, wrong_type]))
        self.assertEqual(report["runs"][0]["framesAttempted"], 3)
        self.assertEqual(report["files"][0]["rejectedLines"], 2)
        warning = [w for w in report["warnings"] if w["code"] == "capture-line-missing-keys"][0]
        self.assertEqual(warning["lines"], [
            {"name": "capture.frame", "key": "capture.frame.index", "count": 1},
            {"name": "capture.frame", "key": "capture.run.id", "count": 1},
        ])

    def test_missing_known_span_name_is_warned(self):
        spans = [s for s in night(saved=3, stopped=False) if s["name"] != "capture.run.started"]
        report = self.report(self.write("observing.jsonl", spans))
        missing = [w for w in report["warnings"] if w["code"] == "known-span-missing"][0]
        self.assertEqual(missing["names"], ["capture.run.started"])
        self.assertIn("run-start-missing", self.warning_codes(report))

    def test_unknown_capture_span_is_warned(self):
        spans = night(saved=2, stopped=False) + [span("capture.attempt", at(90))]
        report = self.report(self.write("observing.jsonl", spans))
        self.assertEqual([w for w in report["warnings"] if w["code"] == "unknown-capture-span"][0]["names"],
                         ["capture.attempt"])


class ObservationTest(TraceCase):
    def test_interruptions_are_matched_per_device_and_open_ones_stay_open(self):
        spans = [
            device_marker("cria.observation.interrupted", at(10), "cam", **{"cria.reading.reason": "barrier"}),
            device_marker("cria.observation.recovered", at(12), "cam", **{"cria.interrupted.ms": 1800}),
            device_marker("cria.observation.interrupted", at(30), "cam", **{"cria.reading.reason": "barrier"}),
            device_marker("cria.observation.recovered", at(31), "mount", **{"cria.interrupted.ms": 500}),
            device_marker("cria.observation.interrupted", at(40), "mount", **{"cria.interrupted.message": "stale"}),
            device_marker("cria.observation.interrupted", at(41), "mount", **{"cria.interrupted.message": "stale"}),
        ]
        report = self.report(self.write("observing.jsonl", spans))
        interruptions = report["interruptions"]
        self.assertEqual((interruptions["total"], interruptions["open"]), (3, 2))
        cam = interruptions["byDevice"]["cam"]
        self.assertEqual((cam["count"], cam["recovered"], cam["open"], cam["totalMs"]), (2, 1, 1, 1800.0))
        self.assertEqual(cam["reasons"], {"barrier": 2})
        self.assertEqual(cam["openSince"], ["2026-01-05T01:00:30.000Z"])
        mount = interruptions["byDevice"]["mount"]
        self.assertEqual((mount["count"], mount["open"], mount["recoveredWithoutInterrupt"], mount["interruptedWhileOpen"]),
                         (1, 1, 1, 1))

    def interrupts(self, count, start):
        spans = []
        for i in range(count):
            spans.append(device_marker("cria.observation.interrupted", at(start + 2 * i), "cam"))
            spans.append(device_marker("cria.observation.recovered", at(start + 2 * i + 1), "cam", **{"cria.interrupted.ms": 1000}))
        return spans

    def refreshes(self, cycles, start, devices=("primary", "guide")):
        spans = []
        for i in range(cycles):
            for device in devices:
                spans.append(device_marker("cria.observation.refreshing", at(start + i), device))
                spans.append(device_marker("cria.observation.refreshed", at(start + i + 0.5), device))
        return spans

    def test_old_build_window_has_only_interrupted_and_warns(self):
        report = self.report(self.write("observing.jsonl", self.interrupts(5, 0)))
        self.assertEqual(report["observation"]["epoch"], "interrupted-only")
        self.assertEqual(sorted(report["observation"]["spans"]), ["cria.observation.interrupted", "cria.observation.recovered"])
        self.assertEqual(report["interruptions"]["total"], 5)
        self.assertIn("interruptions-may-include-refreshes", self.warning_codes(report))

    def test_new_build_window_has_refresh_spans_and_no_interruptions(self):
        report = self.report(self.write("observing.jsonl", self.refreshes(31, 0)))
        self.assertEqual(report["observation"]["epoch"], "refresh-spans")
        self.assertEqual(report["interruptions"]["total"], 0)
        self.assertNotIn("interruptions-may-include-refreshes", self.warning_codes(report))

    def test_window_across_the_change_is_mixed(self):
        spans = self.interrupts(5, 0) + self.refreshes(3, 100)
        report = self.report(self.write("observing.jsonl", spans))
        self.assertEqual(report["observation"]["epoch"], "mixed")
        self.assertIn("observation-epochs-mixed", self.warning_codes(report))
        crop = self.report(self.write("observing.jsonl", spans), "--since", "2026-01-05T01:01:00Z")
        self.assertEqual(crop["observation"]["epoch"], "refresh-spans")

    def test_figures_per_device_are_not_doubled_into_per_frame(self):
        spans = night(saved=31, stopped=False) + self.refreshes(31, 0)
        report = self.report(self.write("observing.jsonl", spans))
        refreshing = report["observation"]["spans"]["cria.observation.refreshing"]
        self.assertEqual(refreshing["count"], 62)
        self.assertEqual(refreshing["byDevice"], {"guide": 31, "primary": 31})
        self.assertEqual(report["runs"][0]["framesAttempted"], 31)


class ErrorsTest(TraceCase):
    def alpaca(self, start, path, message, error=True):
        event = {"name": "exception", "attributes": {"exception.message": message}}
        return span(f"alpaca.get {path}", start, 3000, {"url.path": path}, error=error, events=[event])

    def test_discovery_timeouts_are_named_apart_from_capture_errors(self):
        spans = night(saved=2, stopped=False)
        spans.insert(2, frame("run-1", 9, at(80), 4000, "lost"))
        discovery = "/management/v1/configureddevices"
        spans += [self.alpaca(at(100 + i), discovery, "Alpaca endpoint /management/v1/configureddevices timed out after 3000ms")
                  for i in range(3)]
        spans += [self.alpaca(at(110), "/api/v1/camera/0/imageready", "Unable to reach Alpaca endpoint"),
                  self.alpaca(at(111), discovery, "returned HTTP 500"),
                  self.alpaca(at(112), "/api/v1/camera/0/imageready", "fine", error=False)]
        errors = self.report(self.write("observing.jsonl", spans))["errors"]
        self.assertEqual(errors["alpacaDiscoveryTimeouts"], 3)
        self.assertEqual(errors["capture"], {"capture.frame": 1})
        self.assertEqual(errors["alpaca"], {"alpaca.get /api/v1/camera/0/imageready": 1,
                                            "alpaca.get /management/v1/configureddevices": 1})
        self.assertEqual(errors["other"], {})


class CrossCheckTest(TraceCase):
    def journal(self, records):
        path = self.dir / "frames.jsonl"
        path.write_text("".join(json.dumps(r) + "\n" for r in records))
        return path

    def record(self, run_id, attempt, outcome="saved", started=None):
        return {"version": 1, "runId": run_id, "attempt": attempt, "outcome": outcome,
                "startedAt": stamp(started or at(attempt))}

    def test_agreeing_journal(self):
        trace = self.write("observing.jsonl", night())
        records = [self.record("run-1", i) for i in range(1, 31)] + [self.record("run-1", 31, "stopped")]
        check = self.report(trace, "--frames", self.journal(records))["framesJournal"]
        self.assertEqual((check["attemptsInJournal"], check["attemptsInTrace"], check["difference"]), (31, 31, 0))
        self.assertTrue(check["agrees"])

    def test_mismatching_journal_is_reported_with_the_difference(self):
        trace = self.write("observing.jsonl", night())
        records = [self.record("run-1", i) for i in range(1, 31)]
        records.append(self.record("run-1", 30))
        report = self.report(trace, "--frames", self.journal(records))
        check = report["framesJournal"]
        self.assertEqual((check["attemptsInJournal"], check["attemptsInTrace"], check["difference"]), (30, 31, -1))
        self.assertFalse(check["agrees"])
        self.assertEqual(check["runs"], [{"runId": "run-1", "trace": 31, "journal": 30, "agrees": False}])
        self.assertIn("frames-journal-differs", self.warning_codes(report))

    def test_journal_lines_of_another_version_are_skipped(self):
        trace = self.write("observing.jsonl", night(saved=2, stopped=False))
        records = [self.record("run-1", 1), self.record("run-1", 2), {**self.record("run-1", 3), "version": 2}]
        check = self.report(trace, "--frames", self.journal(records))["framesJournal"]
        self.assertEqual((check["skippedLines"], check["agrees"]), (1, True))

    def test_saved_images_count_original_fits_not_files(self):
        root = self.dir / "saved-images"
        inside, outside = datetime(2026, 1, 5, 2, tzinfo=timezone.utc), datetime(2026, 1, 3, tzinfo=timezone.utc)
        for n in range(5):
            folder = root / "rig-hash" / f"image-{n}"
            folder.mkdir(parents=True)
            for name in ("original.fits", "preview.png", "fit.png", "metadata.json", "manifest.json"):
                (folder / name).write_text("x")
            moment = (inside if n < 3 else outside).timestamp()
            os.utime(folder / "original.fits", (moment, moment))
        (root / "rig-hash" / "partial").mkdir()
        (root / "rig-hash" / "partial" / "preview.png").write_text("x")
        (root / "stray.txt").write_text("x")
        trace = self.write("observing.jsonl", night(saved=3, stopped=False))
        images = self.report(trace, "--since", "2026-01-05T00:00:00Z", "--saved-images", root)["savedImages"]
        self.assertEqual((images["originalFits"], images["originalFitsAnyTime"]), (3, 5))
        self.assertIn("filesystem count", images["kind"])
        self.assertEqual(self.report(trace)["runs"][0]["framesSaved"], 3)


class RefusalTest(TraceCase):
    def test_exit_codes_and_json_errors(self):
        code, bad = trace_report.run([], now=NOW)
        self.assertEqual((code, bad["error"]["code"]), (1, "bad-arguments"))
        code, bad = trace_report.run(["x", "--since", "yesterday"], now=NOW)
        self.assertEqual((code, bad["error"]["code"]), (1, "bad-arguments"))
        self.assertEqual(trace_report.run([str(self.dir / "missing.jsonl")], now=NOW)[1]["error"]["code"], "no-readable-trace")
        self.assertEqual(trace_report.run([str(self.dir / "missing.jsonl")], now=NOW)[0], 2)
        self.assertEqual(trace_report.run([str(self.dir)], now=NOW)[0], 2)
        notes = self.dir / "notes.txt"
        notes.write_text("hello\nworld\n")
        code, refused = trace_report.run([str(notes)], now=NOW)
        self.assertEqual((code, refused["error"]["code"]), (2, "not-a-trace"))
        empty = self.dir / "empty.jsonl"
        empty.write_text("")
        self.assertEqual(trace_report.run([str(empty)], now=NOW)[0], 2)
        self.assertEqual(trace_report.run([str(self.write("t.jsonl", night(saved=1, stopped=False))), "--frames",
                                           str(self.dir / "nope.jsonl")], now=NOW)[0], 2)

    def test_environment_failure_is_exit_3(self):
        trace = self.write("observing.jsonl", night(saved=1, stopped=False))
        real_open = open

        def failing(path, *args, **kwargs):
            if str(path) == str(trace):
                raise OSError(5, "Input/output error")
            return real_open(path, *args, **kwargs)

        original = trace_report.open if hasattr(trace_report, "open") else None
        trace_report.open = failing
        try:
            code, document = trace_report.run([str(trace)], now=NOW)
        finally:
            if original is None:
                del trace_report.open
        self.assertEqual((code, document["error"]["code"]), (3, "environment"))

    def test_runs_isolated_from_stdin_and_prints_json(self):
        trace = self.write("observing.jsonl", night())
        for command, stdin in (
            ([sys.executable, "-I", str(SCRIPT), str(trace)], None),
            ([sys.executable, "-I", "-", str(trace)], SCRIPT.read_text()),
        ):
            done = subprocess.run(command, input=stdin, capture_output=True, text=True, cwd=self.dir)
            self.assertEqual(done.returncode, 0, done.stderr)
            self.assertEqual(json.loads(done.stdout)["totals"]["framesAttempted"], 31)
        done = subprocess.run([sys.executable, "-I", str(SCRIPT)], capture_output=True, text=True)
        self.assertEqual(done.returncode, 1)
        self.assertEqual(json.loads(done.stdout)["error"]["code"], "bad-arguments")


class MemoryTest(TraceCase):
    def test_a_20_mib_file_is_streamed(self):
        path = self.dir / "observing.jsonl"
        filler = span("alpaca.get /api/v1/camera/0/imageready", at(0), 20, {"url.path": "/api/v1/camera/0/imageready", "pad": "x" * 350})
        size = count = 0
        with open(path, "w") as out:
            while size < 20 * 1024 * 1024:
                filler["spanId"] = f"{count:016x}"
                line = json.dumps(filler) + "\n"
                out.write(line)
                size += len(line)
                count += 1
        tracemalloc.start()
        try:
            report = self.report(path)
            peak = tracemalloc.get_traced_memory()[1]
        finally:
            tracemalloc.stop()
        self.assertEqual(report["coverage"]["spansRead"], count)
        self.assertLess(peak, 30 * 1024 * 1024)


if __name__ == "__main__":
    unittest.main()
