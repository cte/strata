#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from wiki_common import WIKI_ROOT, frontmatter, load_dotenv, slugify, utc_now, write_once


RAW_DIR = WIKI_ROOT / "raw" / "granola"


def request_json(url: str, token: str) -> Any:
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def meetings_from_payload(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("meetings", "data", "results", "items"):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    return []


def first_value(item: dict[str, Any], keys: tuple[str, ...], default: str = "") -> str:
    for key in keys:
        value = item.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return default


def normalize_attendees(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    attendees: list[str] = []
    for item in value:
        if isinstance(item, str):
            attendees.append(item)
        elif isinstance(item, dict):
            name = first_value(item, ("name", "display_name", "email"))
            if name:
                attendees.append(name)
    return attendees


def meeting_date(item: dict[str, Any]) -> str:
    raw = first_value(item, ("date", "start_time", "startTime", "created_at", "createdAt"))
    if raw:
        return raw[:10]
    return utc_now().date().isoformat()


def meeting_transcript(item: dict[str, Any]) -> str:
    for key in ("transcript", "notes", "text", "content", "markdown"):
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def fetch_detail_if_needed(item: dict[str, Any], token: str, template: str | None) -> dict[str, Any]:
    if meeting_transcript(item) or not template:
        return item
    meeting_id = first_value(item, ("id", "meeting_id", "uuid"))
    if not meeting_id:
        return item
    url = template.format(id=urllib.parse.quote(meeting_id))
    detail = request_json(url, token)
    if isinstance(detail, dict):
        merged = dict(item)
        merged.update(detail)
        return merged
    return item


def render_meeting(item: dict[str, Any], pulled_at: str) -> tuple[Path, str]:
    date = meeting_date(item)
    title = first_value(item, ("title", "name", "summary"), "Untitled meeting")
    attendees = normalize_attendees(item.get("attendees") or item.get("participants"))
    source_url = first_value(item, ("source_url", "url", "app_url", "web_url"))
    transcript = meeting_transcript(item)
    slug = slugify(title, fallback="meeting")
    path = RAW_DIR / f"{date}-{slug}.md"
    metadata = frontmatter(
        {
            "type": "raw_granola_transcript",
            "source": "granola",
            "date": date,
            "title": title,
            "attendees": attendees,
            "source_url": source_url or None,
            "pulled_at": pulled_at,
        }
    )
    body = transcript or "_No transcript text was present in the API response._"
    return path, f"{metadata}\n# {title}\n\n{body.rstrip()}\n"


def build_url(base_url: str, since: str) -> str:
    parsed = urllib.parse.urlparse(base_url)
    query = dict(urllib.parse.parse_qsl(parsed.query))
    query.setdefault("since", since)
    return urllib.parse.urlunparse(parsed._replace(query=urllib.parse.urlencode(query)))


def main() -> int:
    parser = argparse.ArgumentParser(description="Pull Granola transcripts into raw/granola.")
    parser.add_argument("--since", default=(dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1)).isoformat())
    parser.add_argument("--fixture", type=Path, help="Read a saved JSON payload instead of calling the API.")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    load_dotenv()
    token = os.environ.get("GRANOLA_API_TOKEN", "")
    meetings_url = os.environ.get("GRANOLA_MEETINGS_URL", "")
    transcript_template = os.environ.get("GRANOLA_TRANSCRIPT_URL_TEMPLATE") or None

    try:
        if args.fixture:
            payload = json.loads(args.fixture.read_text(encoding="utf-8"))
        else:
            if not token or not meetings_url:
                print(
                    "Set GRANOLA_API_TOKEN and GRANOLA_MEETINGS_URL in .env, or pass --fixture. "
                    "Do not hardcode undocumented Granola endpoints.",
                    file=sys.stderr,
                )
                return 2
            payload = request_json(build_url(meetings_url, args.since), token)
    except (OSError, json.JSONDecodeError, urllib.error.URLError) as exc:
        print(f"Failed to fetch Granola payload: {exc}", file=sys.stderr)
        return 1

    pulled_at = utc_now().isoformat(timespec="seconds")
    written = 0
    skipped = 0
    for meeting in meetings_from_payload(payload):
        if token:
            meeting = fetch_detail_if_needed(meeting, token, transcript_template)
        path, content = render_meeting(meeting, pulled_at)
        if args.dry_run:
            print(path.relative_to(WIKI_ROOT))
            continue
        if write_once(path, content):
            written += 1
            print(f"wrote {path.relative_to(WIKI_ROOT)}")
        else:
            skipped += 1
            print(f"skipped existing {path.relative_to(WIKI_ROOT)}")

    print(f"Granola pull complete: {written} written, {skipped} skipped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
