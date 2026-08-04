"""Release notes for the "What's new" release popup, parsed from the
CHANGELOG.md shipped inside the image (repo root in dev).

The file follows Keep a Changelog: entries accumulate under
``## [Unreleased]`` until a release. The parser always takes the FIRST
``## [...]`` section - so while the repo never cuts version headings the
popup shows the accumulated "Latest changes", and once headings like
``## [1.2.3] - 2026-08-01`` are adopted the newest release wins
automatically, with no code change.
"""

import logging
import re
from pathlib import Path

from django.conf import settings

logger = logging.getLogger(__name__)

CHANGELOG_PATH = Path(settings.BASE_DIR).parent / "CHANGELOG.md"

# Popup-sized caps: a wall of text helps nobody.
MAX_SECTIONS = 4
MAX_ITEMS = 12
MAX_ITEM_LEN = 240

_cache = {"mtime": None, "notes": None}


def _strip_md(text):
    return text.replace("**", "").replace("`", "").strip()


def parse_release_notes(markdown_text):
    """Shape the newest changelog section for the popup.

    Returns ``{"heading": str, "sections": [{"title", "items"}],
    "truncated": bool}``.
    """
    notes = {"heading": "", "sections": [], "truncated": False}
    if not markdown_text:
        return notes

    top = re.split(r"(?m)^## ", markdown_text)
    if len(top) < 2:
        return notes
    first = top[1]

    heading_line = first.splitlines()[0].strip()
    m = re.match(r"\[([^\]]+)\]", heading_line)
    if not m:
        return notes
    notes["heading"] = "Latest changes" if m.group(1).lower() == "unreleased" else m.group(1)

    total = 0
    for sub in re.split(r"(?m)^### ", first)[1:]:
        if len(notes["sections"]) >= MAX_SECTIONS or total >= MAX_ITEMS:
            notes["truncated"] = True
            break
        lines = sub.splitlines()
        title = _strip_md(lines[0].strip()) if lines else ""
        items = []
        for line in lines[1:]:
            line = line.strip()
            if not line.startswith("- "):
                continue
            if total >= MAX_ITEMS:
                notes["truncated"] = True
                break
            item = _strip_md(line[2:])
            if len(item) > MAX_ITEM_LEN:
                item = item[:MAX_ITEM_LEN - 3].rsplit(" ", 1)[0] + "..."
            if item:
                items.append(item)
                total += 1
        if items:
            notes["sections"].append({"title": title, "items": items})
    return notes


def get_release_notes():
    """Mtime-cached accessor - the file only changes on deployment."""
    try:
        mtime = CHANGELOG_PATH.stat().st_mtime
    except OSError:
        return {"heading": "", "sections": [], "truncated": False}
    if _cache["mtime"] != mtime:
        try:
            text = CHANGELOG_PATH.read_text(encoding="utf-8")
        except OSError:
            logger.warning("CHANGELOG.md not readable at %s", CHANGELOG_PATH)
            return {"heading": "", "sections": [], "truncated": False}
        _cache["notes"] = parse_release_notes(text)
        _cache["mtime"] = mtime
    return _cache["notes"]
