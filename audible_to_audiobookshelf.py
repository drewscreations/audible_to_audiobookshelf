#!/usr/bin/env python3
"""Import Audible listening history into Audiobookshelf.

Reads Audible's `Listening.csv` export and syncs it into Audiobookshelf as:

1) Local playback sessions (for listening stats)
   POST /api/session/local-all
2) Media progress (for Continue Listening)
   PATCH /api/me/progress/batch/update

Why both?
- Listening sessions drive the per-day and per-title listening stats.
- Media progress sets the latest position and finished status.

The Audible export often contains duplicate rows for the same underlying listen
(e.g., "Part 1", "Part 2", "FullTitle" entries with identical positions).
We de-duplicate by (date, ASIN, startPos, endPos, durationMs).

Usage (example)
  # With secrets.txt (recommended)
  python audible_to_audiobookshelf.py --csv Listening.csv

  # Or explicit flags
  python audible_to_audiobookshelf.py \
    --abs-url http://NAS:13378 \
    --token "<ABS API token>" \
    --csv Listening.csv

Tip: run once with --dry-run to see how many items match by ASIN.

Tested against the public Audiobookshelf API schema (local session sync and
batch progress update).
"""

from __future__ import annotations

import argparse
import calendar
import csv
import dataclasses
import datetime as dt
import json
import os
import platform
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

try:
    import requests  # type: ignore
except Exception as e:  # pragma: no cover
    requests = None


# ------------------------- Secrets loader -------------------------

def load_secrets(path: str) -> dict:
    """Load key=value pairs from a secrets file.

    Format:
      ABS_URL=http://nas:13378
      ABS_TOKEN=...

    - Lines starting with # are ignored
    - Blank lines are ignored
    - Whitespace around keys/values is stripped
    - Surrounding single/double quotes around values are removed
    """
    out: dict = {}
    if not path:
        return out
    try:
        fp = Path(path)
        if not fp.exists():
            return out
        for raw in fp.read_text(encoding='utf-8').splitlines():
            line = raw.strip()
            if not line or line.startswith('#'):
                continue
            if '=' not in line:
                continue
            k, v = line.split('=', 1)
            k = k.strip()
            v = v.strip()
            # Strip optional surrounding quotes
            if len(v) >= 2 and ((v[0] == v[-1] == "'") or (v[0] == v[-1] == '\"')):
                v = v[1:-1].strip()
            if k:
                out[k] = v
    except Exception:
        # Don't hard-fail if secrets are unreadable; user can pass flags/env instead.
        return {}
    return out


# ------------------------- Audible CSV parsing -------------------------

AUDIBLE_REQUIRED_FIELDS = {
    "Start Date",
    "Event Duration Milliseconds",
    "Start Position Milliseconds",
    "End Position Milliseconds",
    "Product Name",
    "ASIN",
    "Book Length Milliseconds",
}


def _clean_fieldname(name: str) -> str:
    """Normalize Audible field names (BOM, quoting)."""
    if name is None:
        return ""
    name = name.strip()
    # Strip leading BOM if present
    name = name.lstrip("\ufeff")
    # Audible sometimes puts quotes around header names
    if len(name) >= 2 and name[0] == '"' and name[-1] == '"':
        name = name[1:-1]
    return name.strip()


def _safe_int(x: Any, default: int = 0) -> int:
    try:
        if x is None:
            return default
        s = str(x).strip()
        if s == "":
            return default
        return int(float(s))
    except Exception:
        return default


def _safe_float(x: Any, default: float = 0.0) -> float:
    try:
        if x is None:
            return default
        s = str(x).strip()
        if s == "":
            return default
        return float(s)
    except Exception:
        return default


def _parse_date_yyyy_mm_dd(s: str) -> Optional[dt.date]:
    s = (s or "").strip()
    if not s:
        return None
    try:
        return dt.datetime.strptime(s, "%Y-%m-%d").date()
    except Exception:
        return None


@dataclasses.dataclass
class AudibleAggregateDay:
    asin: str
    date: str  # YYYY-MM-DD
    title: str
    total_listen_seconds: float
    min_start_pos_ms: int
    max_end_pos_ms: int
    # For progress sync
    first_listen_date: str
    last_listen_date: str


def aggregate_audible_listening(csv_path: str, max_rows: int | None = None) -> Tuple[List[AudibleAggregateDay], Dict[str, Any]]:
    """Stream-parse Listening.csv and aggregate per (ASIN, date)."""

    if not os.path.exists(csv_path):
        raise FileNotFoundError(f"CSV not found: {csv_path}")

    # (asin, date) -> mutable agg
    aggs: Dict[Tuple[str, str], Dict[str, Any]] = {}
    # Track first/last listen date per ASIN
    asin_dates: Dict[str, Dict[str, str]] = {}

    dedupe_seen: set = set()

    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None:
            raise ValueError("CSV has no header row")

        # Normalize headers
        reader.fieldnames = [_clean_fieldname(h) for h in reader.fieldnames]

        missing = AUDIBLE_REQUIRED_FIELDS.difference(set(reader.fieldnames))
        if missing:
            raise ValueError(
                "Listening.csv header didn't match expected fields. "
                f"Missing: {sorted(missing)}\n"
                f"Got fields: {reader.fieldnames}"
            )
        rows_read = 0

        for row in reader:
            rows_read += 1
            if max_rows is not None and rows_read > max_rows:
                break
            # Normalize keys in the row too (DictReader keeps original headers)
            row = {_clean_fieldname(k): v for k, v in row.items()}

            asin = (row.get("ASIN") or "").strip()
            if not asin:
                # Can't reliably match in ABS without an ASIN.
                continue

            start_date = row.get("Start Date") or ""
            d = _parse_date_yyyy_mm_dd(start_date)
            if d is None:
                continue
            date_str = d.strftime("%Y-%m-%d")

            duration_ms = _safe_int(row.get("Event Duration Milliseconds"), 0)
            start_pos_ms = _safe_int(row.get("Start Position Milliseconds"), 0)
            end_pos_ms = _safe_int(row.get("End Position Milliseconds"), 0)

            # Dedupe duplicates (Part 1/Part 2/FullTitle) by the actual listening tuple
            dedupe_key = (date_str, asin, start_pos_ms, end_pos_ms, duration_ms)
            if dedupe_key in dedupe_seen:
                continue
            dedupe_seen.add(dedupe_key)

            title = (row.get("Product Name") or "").strip()

            key = (asin, date_str)
            a = aggs.get(key)
            if a is None:
                a = {
                    "asin": asin,
                    "date": date_str,
                    "title": title,
                    "total_listen_seconds": 0.0,
                    "min_start_pos_ms": start_pos_ms,
                    "max_end_pos_ms": end_pos_ms,
                }
                aggs[key] = a
            else:
                # Prefer a more complete-looking title if we see one
                if title and (len(title) > len(a.get("title", ""))):
                    a["title"] = title
                a["min_start_pos_ms"] = min(a["min_start_pos_ms"], start_pos_ms)
                a["max_end_pos_ms"] = max(a["max_end_pos_ms"], end_pos_ms)

            a["total_listen_seconds"] += duration_ms / 1000.0

            # First/last date tracking per ASIN
            dates = asin_dates.get(asin)
            if dates is None:
                asin_dates[asin] = {"first": date_str, "last": date_str}
            else:
                if date_str < dates["first"]:
                    dates["first"] = date_str
                if date_str > dates["last"]:
                    dates["last"] = date_str

    days: List[AudibleAggregateDay] = []
    for (asin, date_str), a in sorted(aggs.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        dates = asin_dates.get(asin) or {"first": date_str, "last": date_str}
        days.append(
            AudibleAggregateDay(
                asin=asin,
                date=date_str,
                title=a.get("title", ""),
                total_listen_seconds=float(a.get("total_listen_seconds", 0.0)),
                min_start_pos_ms=int(a.get("min_start_pos_ms", 0)),
                max_end_pos_ms=int(a.get("max_end_pos_ms", 0)),
                first_listen_date=dates["first"],
                last_listen_date=dates["last"],
            )
        )

    stats = {
        "rows_aggregated": len(days),
        "unique_asins": len({d.asin for d in days}),
    }
    return days, stats


# ------------------------- Audiobookshelf client -------------------------

class ABSClient:
    def __init__(self, base_url: str, token: str, timeout_s: int = 30):
        if requests is None:
            raise RuntimeError(
                "The 'requests' package is required. Install with: pip install requests"
            )
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout_s = timeout_s

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    def _url(self, path: str) -> str:
        if not path.startswith("/"):
            path = "/" + path
        return self.base_url + path

    def get(self, path: str, params: Optional[Dict[str, Any]] = None) -> Any:
        r = requests.get(self._url(path), headers=self._headers(), params=params, timeout=self.timeout_s)
        r.raise_for_status()
        return r.json() if r.content else None

    def post(self, path: str, body: Any) -> Any:
        r = requests.post(self._url(path), headers=self._headers(), data=json.dumps(body), timeout=self.timeout_s)
        r.raise_for_status()
        return r.json() if r.content else None

    def patch(self, path: str, body: Any) -> Any:
        r = requests.patch(self._url(path), headers=self._headers(), data=json.dumps(body), timeout=self.timeout_s)
        r.raise_for_status()
        return r.json() if r.content else None

    # Convenience API wrappers
    def me(self) -> Dict[str, Any]:
        return self.get("/api/me")

    def libraries(self) -> List[Dict[str, Any]]:
        """Return list of libraries.

        The ABS API returns an object like {"libraries": [...]} for
        GET /api/libraries (per the official API docs). We normalize that into a
        plain list for the rest of the script.
        """
        data = self.get("/api/libraries")
        if isinstance(data, dict):
            libs = data.get("libraries")
            if isinstance(libs, list):
                return libs
        if isinstance(data, list):
            return data
        raise ValueError(
            f"Unexpected response from GET /api/libraries: {type(data).__name__}"
        )

    def library_items(self, library_id: str) -> Dict[str, Any]:
        # limit=0 => no limit (returns all results) per docs.
        return self.get(
            f"/api/libraries/{library_id}/items",
            params={
                "limit": 0,
                "page": 0,
                "minified": 1,
                "collapseseries": 0,
            },
        )

    def sync_local_sessions(self, sessions: List[Dict[str, Any]]) -> Dict[str, Any]:
        return self.post("/api/session/local-all", {"sessions": sessions})

    def update_progress_batch(self, updates: List[Dict[str, Any]]) -> Any:
        return self.patch("/api/me/progress/batch/update", updates)


# ------------------------- Sync logic -------------------------


def _epoch_ms_for_date_midday(date_str: str, tz_offset_hours: int = 0, offset_seconds: int = 0) -> int:
    """Create a stable timestamp for a date (midday UTC-ish).

    We don't have time-of-day from Audible's export, only the day.
    Using midday avoids DST edge cases around midnight.
    """
    d = dt.datetime.strptime(date_str, "%Y-%m-%d").date()
    t = dt.datetime(d.year, d.month, d.day, 12, 0, 0)
    t = t + dt.timedelta(hours=tz_offset_hours, seconds=offset_seconds)
    return int(t.replace(tzinfo=dt.timezone.utc).timestamp() * 1000)


def build_asin_index(libraries: List[Dict[str, Any]], items_by_library: Dict[str, Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Build ASIN -> item info mapping."""
    asin_map: Dict[str, Dict[str, Any]] = {}
    for lib in libraries:
        lib_id = lib.get("id")
        if not lib_id:
            continue
        data = items_by_library.get(lib_id)
        if not data:
            continue
        for it in data.get("results", []) or []:
            media = it.get("media") or {}
            md = (media.get("metadata") or {})
            asin = (md.get("asin") or "").strip()
            if not asin:
                continue
            # Prefer first seen; if duplicates, keep the first.
            if asin not in asin_map:
                asin_map[asin] = it
    return asin_map


def chunked(seq: List[Any], size: int) -> Iterable[List[Any]]:
    for i in range(0, len(seq), size):
        yield seq[i : i + size]


def run_sync(
    *,
    csv_path: str,
    abs_url: str,
    token: str,
    dry_run: bool,
    batch_size: int,
    since: Optional[str],
    finish_threshold: float,
    only_library_id: Optional[str],
    no_progress: bool,
    report_path: Optional[str],
    max_rows: Optional[int] = None,
) -> int:
    days, stats = aggregate_audible_listening(csv_path, max_rows=max_rows)

    if since:
        days = [d for d in days if d.date >= since]

    print(f"Audible aggregates: {stats['rows_aggregated']} day-rows, {stats['unique_asins']} ASINs")
    if since:
        print(f"Filtered to since={since}: {len(days)} day-rows")

    if dry_run and (not abs_url or not token):
        # Dry run without talking to ABS: just summarize Audible.
        summary = {
            "audible": stats,
            "filtered_day_rows": len(days),
            "first_day": min((d.date for d in days), default=None),
            "last_day": max((d.date for d in days), default=None),
            "unique_asins_filtered": len({d.asin for d in days}),
        }
        out = report_path or "audible_import_report.json"
        with open(out, "w", encoding="utf-8") as f:
            json.dump(summary, f, indent=2)
        print(f"Wrote report: {out}")
        return 0

    if not abs_url or not token:
        print("ERROR: --abs-url and --token are required (unless using --dry-run without API).", file=sys.stderr)
        return 2

    client = ABSClient(abs_url, token)
    me = client.me()
    user_id = me.get("id")
    if not user_id:
        print("ERROR: Could not determine user id from /api/me", file=sys.stderr)
        return 2

    libs = client.libraries() or []
    # Choose book libraries
    book_libs = [l for l in libs if (l.get("mediaType") == "book")]
    if only_library_id:
        book_libs = [l for l in book_libs if l.get("id") == only_library_id]

    if not book_libs:
        print("ERROR: No book libraries found (or none matched --library-id)", file=sys.stderr)
        return 2

    print(f"Audiobookshelf: user={me.get('username', user_id)} | book libraries={len(book_libs)}")

    # Fetch items per library (minified)
    items_by_library: Dict[str, Dict[str, Any]] = {}
    for lib in book_libs:
        lib_id = lib.get("id")
        name = lib.get("name") or lib_id
        print(f"Fetching items for library: {name} ({lib_id}) ...")
        items_by_library[lib_id] = client.library_items(lib_id)

    asin_map = build_asin_index(book_libs, items_by_library)

    # Match Audible aggregates to ABS items
    matched: List[Tuple[AudibleAggregateDay, Dict[str, Any]]] = []
    unmatched: List[AudibleAggregateDay] = []
    for d in days:
        it = asin_map.get(d.asin)
        if it is None:
            unmatched.append(d)
        else:
            matched.append((d, it))

    print(f"Matched by ASIN: {len(matched)} day-rows")
    if unmatched:
        print(f"Unmatched: {len(unmatched)} day-rows (unique ASINs: {len({u.asin for u in unmatched})})")

    # Build local playback session payloads
    device_id = "audible-import"
    server_version = "audible-import"

    sessions: List[Dict[str, Any]] = []
    for idx, (d, it) in enumerate(matched):
        media = it.get("media") or {}
        md = media.get("metadata") or {}

        duration_sec = float(media.get("duration") or 0.0)
        start_sec = d.min_start_pos_ms / 1000.0
        current_sec = d.max_end_pos_ms / 1000.0

        # Stable UUID per (asin, date) so reruns update the same session
        sid = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"audible:{d.asin}:{d.date}"))

        started_at = _epoch_ms_for_date_midday(d.date, offset_seconds=idx % 3600)
        updated_at = started_at + int(d.total_listen_seconds * 1000)

        day_name = calendar.day_name[dt.datetime.strptime(d.date, "%Y-%m-%d").weekday()]

        sessions.append(
            {
                "id": sid,
                "userId": user_id,
                "libraryId": it.get("libraryId"),
                "libraryItemId": it.get("id"),
                "episodeId": None,
                "mediaType": "book",
                "mediaMetadata": md,
                "chapters": [],
                "displayTitle": md.get("title") or d.title or "",
                "displayAuthor": md.get("authorName") or md.get("author") or "",
                "coverPath": media.get("coverPath") or "",
                "duration": duration_sec,
                "playMethod": 3,  # Local
                "mediaPlayer": "AudibleImport",
                "deviceInfo": {
                    "userId": user_id,
                    "deviceId": device_id,
                    "ipAddress": None,
                    "browserName": None,
                    "browserVersion": None,
                    "osName": platform.system(),
                    "osVersion": platform.release(),
                    "clientName": "AudibleImport",
                    "clientVersion": "1.0",
                },
                "serverVersion": server_version,
                "date": d.date,
                "dayOfWeek": day_name,
                "timeListening": float(d.total_listen_seconds),
                "startTime": float(start_sec),
                "currentTime": float(current_sec),
                "startedAt": int(started_at),
                "updatedAt": int(updated_at),
            }
        )

    report = {
        "audible": stats,
        "filtered_day_rows": len(days),
        "matched_day_rows": len(matched),
        "unmatched_day_rows": len(unmatched),
        "unique_asins_matched": len({d.asin for d, _ in matched}),
        "unique_asins_unmatched": len({d.asin for d in unmatched}),
        "unmatched_samples": [
            {"date": u.date, "asin": u.asin, "title": u.title} for u in unmatched[:50]
        ],
    }

    if report_path:
        with open(report_path, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2)
        print(f"Wrote report: {report_path}")

    if dry_run:
        print("Dry run: not sending anything to Audiobookshelf.")
        return 0

    # Sync sessions in batches
    total_synced = 0
    total_failed = 0
    for batch in chunked(sessions, batch_size):
        resp = client.sync_local_sessions(batch)
        results = resp.get("results", []) if isinstance(resp, dict) else []
        ok = sum(1 for r in results if r.get("success"))
        bad = sum(1 for r in results if not r.get("success"))
        total_synced += ok
        total_failed += bad
        print(f"Synced sessions batch: ok={ok} failed={bad}")
        if bad:
            # Print first few errors
            errs = [r for r in results if not r.get("success")][:5]
            for e in errs:
                print(f"  - session {e.get('id')}: {e.get('error')}")

    print(f"Session sync complete: ok={total_synced} failed={total_failed}")

    if no_progress:
        print("Skipping progress updates (--no-progress).")
        return 0 if total_failed == 0 else 1

    # Build per-item progress updates using max currentTime across all days
    per_item: Dict[str, Dict[str, Any]] = {}
    for d, it in matched:
        item_id = it.get("id")
        if not item_id:
            continue
        media = it.get("media") or {}
        duration_sec = float(media.get("duration") or 0.0)

        p = per_item.get(item_id)
        if p is None:
            p = {
                "libraryItemId": item_id,
                "episodeId": None,
                "duration": duration_sec,
                "currentTime": d.max_end_pos_ms / 1000.0,
                "first": d.first_listen_date,
                "last": d.last_listen_date,
            }
            per_item[item_id] = p
        else:
            p["currentTime"] = max(float(p["currentTime"]), d.max_end_pos_ms / 1000.0)
            p["first"] = min(p["first"], d.first_listen_date)
            p["last"] = max(p["last"], d.last_listen_date)

    updates: List[Dict[str, Any]] = []
    for item_id, p in per_item.items():
        duration = float(p.get("duration") or 0.0)
        cur = float(p.get("currentTime") or 0.0)
        prog = (cur / duration) if duration > 0 else 0.0
        prog = max(0.0, min(1.0, prog))
        is_finished = prog >= finish_threshold or (duration > 0 and cur >= max(0.0, duration - 60.0))

        started_at = _epoch_ms_for_date_midday(str(p["first"]))
        last_update = _epoch_ms_for_date_midday(str(p["last"]))
        finished_at = last_update if is_finished else None

        updates.append(
            {
                "libraryItemId": item_id,
                "episodeId": None,
                "duration": duration,
                "currentTime": cur,
                "progress": 1.0 if is_finished else prog,
                "isFinished": bool(is_finished),
                "startedAt": int(started_at),
                "finishedAt": int(finished_at) if finished_at is not None else None,
            }
        )

    for batch in chunked(updates, 200):
        client.update_progress_batch(batch)
        print(f"Updated progress for {len(batch)} items")

    print("Done.")
    return 0 if total_failed == 0 else 1


# ------------------------- CLI -------------------------


def main() -> int:
    default_csv = "Listening.csv"
    if not os.path.exists(default_csv) and os.path.exists("/mnt/data/Listening.csv"):
        default_csv = "/mnt/data/Listening.csv"

    # Prefer a local secrets.txt if present; otherwise /mnt/data/secrets.txt
    default_secrets = "secrets.txt"
    if not os.path.exists(default_secrets) and os.path.exists("/mnt/data/secrets.txt"):
        default_secrets = "/mnt/data/secrets.txt"

    ap = argparse.ArgumentParser(description="Import Audible Listening.csv into Audiobookshelf")
    ap.add_argument("--csv", default=default_csv, help="Path to Audible Listening.csv")
    ap.add_argument(
        "--secrets",
        default=default_secrets,
        help=(
            "Path to secrets.txt (key=value lines). Supported keys: ABS_URL, ABS_TOKEN, ABS_LIBRARY_ID, AUDIBLE_SINCE. "
            "CLI flags override secrets.txt."
        ),
    )

    # Keep CLI defaults empty so we can resolve from secrets/env in a predictable order:
    # CLI > secrets.txt > environment
    ap.add_argument("--abs-url", default="", help="Audiobookshelf base URL (e.g. http://nas:13378)")
    ap.add_argument("--token", default="", help="Audiobookshelf API token (Bearer)")
    ap.add_argument("--library-id", default="", help="Only sync to this library id (optional)")
    ap.add_argument("--since", default="", help="Only import dates >= YYYY-MM-DD")

    ap.add_argument(
        "--max-rows",
        type=int,
        default=int(os.getenv("MAX_ROWS", "0")) or 0,
        help="Limit number of CSV rows to read (0 = no limit)",
    )
    ap.add_argument(
        "--batch-size",
        type=int,
        default=int(os.getenv("BATCH_SIZE", "250")),
        help="Sessions per API call",
    )
    ap.add_argument(
        "--finish-threshold",
        type=float,
        default=float(os.getenv("FINISH_THRESHOLD", "0.99")),
        help="Mark finished at this progress fraction",
    )
    ap.add_argument("--dry-run", action="store_true", help="Do everything except send API requests")
    ap.add_argument("--no-progress", action="store_true", help="Do not update media progress")
    ap.add_argument("--report", default=os.getenv("IMPORT_REPORT", ""), help="Write a JSON report to this path")

    args = ap.parse_args()

    secrets = load_secrets(args.secrets)

    abs_url = (args.abs_url.strip() or secrets.get("ABS_URL") or os.getenv("ABS_URL", "")).strip()
    token = (args.token.strip() or secrets.get("ABS_TOKEN") or os.getenv("ABS_TOKEN", "")).strip()

    library_id = (args.library_id.strip() or secrets.get("ABS_LIBRARY_ID") or os.getenv("ABS_LIBRARY_ID", "")).strip()
    since = (args.since.strip() or secrets.get("AUDIBLE_SINCE") or os.getenv("AUDIBLE_SINCE", "")).strip()

    return run_sync(
        csv_path=args.csv,
        abs_url=abs_url,
        token=token,
        dry_run=bool(args.dry_run),
        batch_size=max(1, int(args.batch_size)),
        since=since or None,
        finish_threshold=max(0.0, min(1.0, float(args.finish_threshold))),
        only_library_id=(library_id or None),
        no_progress=bool(args.no_progress),
        report_path=(args.report.strip() or None),
        max_rows=(args.max_rows if args.max_rows and args.max_rows > 0 else None),
    )


if __name__ == "__main__":

    raise SystemExit(main())
