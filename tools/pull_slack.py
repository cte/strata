#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from wiki_common import WIKI_ROOT, frontmatter, load_dotenv, slugify, utc_now, write_once


RAW_DIR = WIKI_ROOT / "raw" / "slack"


def slack_api(method: str, params: dict[str, str], token: str) -> dict[str, Any]:
    url = "https://slack.com/api/" + method + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not payload.get("ok"):
        raise RuntimeError(payload.get("error", "unknown Slack API error"))
    return payload


def load_messages(args: argparse.Namespace) -> tuple[list[dict[str, Any]], dict[str, str]]:
    if args.from_json:
        payload = json.loads(args.from_json.read_text(encoding="utf-8"))
        if isinstance(payload, list):
            messages = payload
            meta: dict[str, str] = {}
        elif isinstance(payload, dict):
            messages = payload.get("messages") or payload.get("replies") or []
            meta = {k: str(v) for k, v in payload.items() if k not in {"messages", "replies"} and not isinstance(v, (dict, list))}
        else:
            messages = []
            meta = {}
        return [m for m in messages if isinstance(m, dict)], meta

    load_dotenv()
    token = os.environ.get("SLACK_BOT_TOKEN", "")
    if not token:
        raise RuntimeError("Set SLACK_BOT_TOKEN in .env or use --from-json")
    if not args.channel or not args.thread_ts:
        raise RuntimeError("Direct Slack fetch requires --channel and --thread-ts")
    payload = slack_api("conversations.replies", {"channel": args.channel, "ts": args.thread_ts}, token)
    return payload.get("messages", []), {"channel": args.channel, "thread_ts": args.thread_ts}


def message_date(ts: str | None) -> str:
    if not ts:
        return utc_now().date().isoformat()
    try:
        return dt.datetime.fromtimestamp(float(ts), tz=dt.timezone.utc).date().isoformat()
    except ValueError:
        return utc_now().date().isoformat()


def render_user(message: dict[str, Any]) -> str:
    return str(message.get("user") or message.get("username") or message.get("bot_id") or "unknown")


def render_messages(messages: list[dict[str, Any]]) -> str:
    lines: list[str] = []
    for message in messages:
        subtype = message.get("subtype")
        if subtype == "bot_message":
            continue
        ts = str(message.get("ts") or "")
        user = render_user(message)
        text = str(message.get("text") or "").strip()
        reactions = message.get("reactions")
        lines.append(f"## {ts} | {user}")
        lines.append("")
        lines.append(text or "_No text_")
        if reactions:
            lines.append("")
            lines.append("Reactions: `" + json.dumps(reactions, sort_keys=True) + "`")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Pull one Slack thread into raw/slack.")
    parser.add_argument("--channel", help="Slack channel ID for direct API fetch.")
    parser.add_argument("--thread-ts", help="Thread timestamp for direct API fetch.")
    parser.add_argument("--from-json", type=Path, help="Captured Slack/MCP JSON file.")
    parser.add_argument("--title", help="Human title for the raw thread file.")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    load_dotenv()
    try:
        messages, meta = load_messages(args)
    except Exception as exc:
        print(f"Failed to load Slack thread: {exc}", file=sys.stderr)
        return 1

    if not messages:
        print("No Slack messages found.", file=sys.stderr)
        return 1

    first = messages[0]
    date = message_date(str(first.get("ts") or ""))
    channel = args.channel or meta.get("channel") or meta.get("channel_id") or "slack"
    thread_ts = args.thread_ts or meta.get("thread_ts") or str(first.get("thread_ts") or first.get("ts") or "")
    title = args.title or str(first.get("text") or "Slack thread")[:80]
    source_url = ""
    workspace_url = os.environ.get("SLACK_WORKSPACE_URL", "").rstrip("/")
    if workspace_url and channel and thread_ts:
        source_url = f"{workspace_url}/archives/{channel}/p{thread_ts.replace('.', '')}"

    path = RAW_DIR / f"{date}-{slugify(channel)}-{slugify(title, 'thread')}.md"
    content = (
        frontmatter(
            {
                "type": "raw_slack_thread",
                "source": "slack",
                "date": date,
                "channel": channel,
                "thread_ts": thread_ts,
                "title": title,
                "source_url": source_url or None,
                "pulled_at": utc_now().isoformat(timespec="seconds"),
            }
        )
        + f"\n# {title}\n\n"
        + render_messages(messages)
    )

    if args.dry_run:
        print(path.relative_to(WIKI_ROOT))
        return 0
    if write_once(path, content):
        print(f"wrote {path.relative_to(WIKI_ROOT)}")
    else:
        print(f"skipped existing {path.relative_to(WIKI_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
