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


RAW_DIR = WIKI_ROOT / "raw" / "notion"


def notion_request(path: str, token: str, version: str) -> dict[str, Any]:
    url = "https://api.notion.com/v1" + path
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Notion-Version": version,
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def rich_text_text(value: list[dict[str, Any]] | None) -> str:
    if not value:
        return ""
    return "".join(str(item.get("plain_text") or "") for item in value)


def page_title(page: dict[str, Any]) -> str:
    properties = page.get("properties") or {}
    for prop in properties.values():
        if isinstance(prop, dict) and prop.get("type") == "title":
            title = rich_text_text(prop.get("title"))
            if title:
                return title
    return "Untitled Notion page"


def fetch_blocks(block_id: str, token: str, version: str) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    start_cursor: str | None = None
    while True:
        query = {"page_size": "100"}
        if start_cursor:
            query["start_cursor"] = start_cursor
        payload = notion_request(f"/blocks/{urllib.parse.quote(block_id)}/children?{urllib.parse.urlencode(query)}", token, version)
        blocks.extend(payload.get("results", []))
        if not payload.get("has_more"):
            break
        start_cursor = payload.get("next_cursor")
    return blocks


def block_to_markdown(block: dict[str, Any]) -> list[str]:
    block_type = block.get("type")
    data = block.get(block_type, {}) if isinstance(block_type, str) else {}
    text = rich_text_text(data.get("rich_text"))
    if block_type == "heading_1":
        return [f"# {text}", ""]
    if block_type == "heading_2":
        return [f"## {text}", ""]
    if block_type == "heading_3":
        return [f"### {text}", ""]
    if block_type == "bulleted_list_item":
        return [f"- {text}"]
    if block_type == "numbered_list_item":
        return [f"1. {text}"]
    if block_type == "to_do":
        mark = "x" if data.get("checked") else " "
        return [f"- [{mark}] {text}"]
    if block_type == "quote":
        return [f"> {text}", ""]
    if block_type == "code":
        language = data.get("language") or ""
        return [f"```{language}", text, "```", ""]
    if block_type == "callout":
        return [f"> {text}", ""]
    if block_type == "child_page":
        title = data.get("title") or "Child page"
        return [f"- Child page: {title}"]
    if block_type == "paragraph":
        return [text, ""] if text else [""]
    return [f"<!-- Unsupported Notion block: {block_type} -->", ""]


def render_blocks(blocks: list[dict[str, Any]], token: str, version: str, depth: int = 0) -> list[str]:
    lines: list[str] = []
    for block in blocks:
        lines.extend(block_to_markdown(block))
        if block.get("has_children") and depth < 3:
            children = fetch_blocks(block["id"], token, version)
            child_lines = render_blocks(children, token, version, depth + 1)
            lines.extend(child_lines)
    return lines


def main() -> int:
    parser = argparse.ArgumentParser(description="Snapshot one Notion page into raw/notion.")
    parser.add_argument("--page-id", required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    load_dotenv()
    token = os.environ.get("NOTION_TOKEN", "")
    version = os.environ.get("NOTION_VERSION", "2022-06-28")
    if not token:
        print("Set NOTION_TOKEN in .env.", file=sys.stderr)
        return 2

    try:
        page = notion_request(f"/pages/{urllib.parse.quote(args.page_id)}", token, version)
        blocks = fetch_blocks(args.page_id, token, version)
    except Exception as exc:
        print(f"Failed to fetch Notion page: {exc}", file=sys.stderr)
        return 1

    title = page_title(page)
    edited_time = str(page.get("last_edited_time") or "")
    date = edited_time[:10] if edited_time else dt.datetime.now(dt.timezone.utc).date().isoformat()
    path = RAW_DIR / f"{date}-{slugify(title, 'notion-page')}.md"
    page_url = str(page.get("url") or "")
    content = (
        frontmatter(
            {
                "type": "raw_notion_page",
                "source": "notion",
                "date": date,
                "title": title,
                "page_id": args.page_id,
                "source_url": page_url or None,
                "pulled_at": utc_now().isoformat(timespec="seconds"),
            }
        )
        + f"\n# {title}\n\n"
        + "\n".join(render_blocks(blocks, token, version)).rstrip()
        + "\n"
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
