from __future__ import annotations

import datetime as dt
import os
import re
from pathlib import Path
from typing import Any


WIKI_ROOT = Path(__file__).resolve().parents[1]


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def today_iso() -> str:
    return utc_now().date().isoformat()


def slugify(value: str, fallback: str = "untitled") -> str:
    value = value.strip().lower()
    value = re.sub(r"['’]", "", value)
    value = re.sub(r"[^a-z0-9]+", "-", value)
    value = value.strip("-")
    return value or fallback


def load_dotenv(path: Path | None = None) -> None:
    env_path = path or WIKI_ROOT / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def yaml_scalar(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value)
    if text == "":
        return '""'
    if re.fullmatch(r"[A-Za-z0-9_./:@+-]+", text):
        return text
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'


def frontmatter(mapping: dict[str, Any]) -> str:
    lines = ["---"]
    for key, value in mapping.items():
        if isinstance(value, list):
            if value:
                lines.append(f"{key}:")
                for item in value:
                    lines.append(f"  - {yaml_scalar(item)}")
            else:
                lines.append(f"{key}: []")
        else:
            lines.append(f"{key}: {yaml_scalar(value)}")
    lines.append("---")
    return "\n".join(lines) + "\n"


def split_frontmatter(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---\n"):
        return {}, text
    end = text.find("\n---", 4)
    if end == -1:
        return {}, text
    raw = text[4:end].strip()
    body = text[end + 4 :].lstrip("\n")
    parsed: dict[str, str] = {}
    for line in raw.splitlines():
        if ":" not in line or line.startswith(" "):
            continue
        key, value = line.split(":", 1)
        parsed[key.strip()] = value.strip().strip('"')
    return parsed, body


def write_once(path: Path, content: str) -> bool:
    if path.exists():
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return True


def parse_date(value: str | None) -> dt.date | None:
    if not value or value in {"null", "None"}:
        return None
    try:
        return dt.date.fromisoformat(value[:10])
    except ValueError:
        return None


def append_log(op: str, title: str) -> None:
    log_path = WIKI_ROOT / "log.md"
    timestamp = utc_now().strftime("%Y-%m-%d %H:%M")
    entry = f"\n\n## [{timestamp}] {op} | {title}\n"
    existing = log_path.read_text(encoding="utf-8") if log_path.exists() else "# Work Wiki — Activity Log\n"
    log_path.write_text(existing.rstrip() + entry, encoding="utf-8")
