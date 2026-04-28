#!/usr/bin/env python3
from __future__ import annotations

import datetime as dt
import re
from collections import defaultdict
from pathlib import Path

from wiki_common import WIKI_ROOT, append_log, parse_date, slugify, split_frontmatter, today_iso


SKIP_ORPHAN_NAMES = {
    "CLAUDE.md",
    "index.md",
    "log.md",
    "me.md",
    "priorities.md",
    "mine.md",
    "theirs.md",
}


def wiki_files() -> list[Path]:
    files: list[Path] = []
    for path in WIKI_ROOT.rglob("*.md"):
        rel = path.relative_to(WIKI_ROOT)
        if rel.parts[0] == "raw":
            continue
        files.append(path)
    return sorted(files)


def wikilinks(text: str) -> list[str]:
    return re.findall(r"\[\[([^\]|#]+)", text)


def page_key(path: Path) -> str:
    return slugify(path.stem)


def action_due_dates(text: str) -> list[tuple[int, dt.date, str]]:
    found: list[tuple[int, dt.date, str]] = []
    patterns = [
        re.compile(r"- \[ \].*?\bdue:\s*(\d{4}-\d{2}-\d{2})", re.IGNORECASE),
        re.compile(r"- \[ \].*?@due\((\d{4}-\d{2}-\d{2})\)", re.IGNORECASE),
    ]
    for lineno, line in enumerate(text.splitlines(), start=1):
        for pattern in patterns:
            match = pattern.search(line)
            if not match:
                continue
            due = parse_date(match.group(1))
            if due:
                found.append((lineno, due, line.strip()))
    return found


def format_list(items: list[str]) -> str:
    if not items:
        return "- None found."
    return "\n".join(f"- {item}" for item in items)


def main() -> int:
    today = dt.date.fromisoformat(today_iso())
    files = wiki_files()
    bodies: dict[Path, str] = {}
    metadata: dict[Path, dict[str, str]] = {}
    missing_frontmatter: list[str] = []
    inbound: dict[str, set[Path]] = defaultdict(set)
    known_keys: dict[str, Path] = {}

    for path in files:
        text = path.read_text(encoding="utf-8")
        fm, body = split_frontmatter(text)
        bodies[path] = body
        metadata[path] = fm
        known_keys[page_key(path)] = path
        if path.name != "log.md" and not fm:
            missing_frontmatter.append(str(path.relative_to(WIKI_ROOT)))
        for link in wikilinks(text):
            inbound[slugify(Path(link).stem)].add(path)

    stale_threads: list[str] = []
    missing_decisions: list[str] = []
    orphan_pages: list[str] = []
    overdue_actions: list[str] = []
    stale_priorities: list[str] = []

    for path, fm in metadata.items():
        rel = path.relative_to(WIKI_ROOT)
        page_type = fm.get("type", "")
        if page_type == "thread" and fm.get("status", "open") == "open":
            opened = parse_date(fm.get("opened"))
            if opened and (today - opened).days > 30:
                stale_threads.append(f"{rel} opened {opened.isoformat()} ({(today - opened).days} days old)")

        if path.name == "priorities.md":
            last_updated = parse_date(fm.get("last_updated"))
            if not last_updated:
                stale_priorities.append("priorities.md has no `last_updated` date.")
            elif (today - last_updated).days > 30:
                stale_priorities.append(f"priorities.md last updated {last_updated.isoformat()} ({(today - last_updated).days} days old)")

        if rel.parts[0] in {"people", "projects", "teams", "meetings", "decisions", "threads"}:
            if path.name not in SKIP_ORPHAN_NAMES and page_key(path) not in inbound:
                orphan_pages.append(str(rel))

        if rel.parts[0] == "actions":
            for lineno, due, line in action_due_dates(path.read_text(encoding="utf-8")):
                if due < today:
                    overdue_actions.append(f"{rel}:{lineno} due {due.isoformat()} | {line}")

    decision_dir = WIKI_ROOT / "decisions"
    decision_keys = {page_key(path) for path in decision_dir.glob("*.md")}
    for path, body in bodies.items():
        for link in wikilinks(body):
            key = slugify(Path(link).stem)
            if re.match(r"\d{4}-\d{2}-\d{2}-", key) and key not in decision_keys and "decision" in link.lower():
                missing_decisions.append(f"{path.relative_to(WIKI_ROOT)} links to missing decision `[[{link}]]`")

    report = f"""# Wiki Lint — {today.isoformat()}

## Open Threads Older Than 30 Days

{format_list(stale_threads)}

## Stale Priorities

{format_list(stale_priorities)}

## Decisions Referenced But Missing

{format_list(sorted(set(missing_decisions)))}

## Orphan Pages

{format_list(orphan_pages)}

## Missing Frontmatter

{format_list(missing_frontmatter)}

## Overdue Action Items

{format_list(overdue_actions)}
"""

    output = WIKI_ROOT / "meta" / "lint" / f"lint-{today.isoformat()}.md"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(report, encoding="utf-8")
    append_log("lint", today.isoformat())
    print(f"wrote {output.relative_to(WIKI_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
