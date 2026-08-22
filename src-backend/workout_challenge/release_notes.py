"""Release notes for the "What's new" release popup, parsed from the
CHANGELOG.md shipped inside the image (repo root in dev).

The file follows Keep a Changelog: entries accumulate under
``## [Unreleased]`` until a release. The parser takes the first
``## [...]`` section that has items, skipping an empty Unreleased so a
cut heading like ``## [0.38.0] - 2026-08-22`` becomes the popup.
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


def _section_has_items(chunk):
    return any(line.strip().startswith("- ") for line in chunk.splitlines())


def parse_release_notes(markdown_text):
    """Shape the newest changelog section for the popup.

    Returns ``{"heading": str, "sections": [{"title", "items"}],
    "truncated": bool}``.
    """
    notes = {"heading": "", "sections": [], "truncated": False}
    if not markdown_text:
        return notes

    top = re.split(r"(?m)^## ", markdown_text)
    first = None
    heading_name = None
    for chunk in top[1:]:
        lines = chunk.splitlines()
        heading_line = lines[0].strip() if lines else ""
        m = re.match(r"\[([^\]]+)\]", heading_line)
        if not m:
            continue
        # Empty Unreleased is the Keep-a-Changelog placeholder after a
        # cut; skip it so the version heading underneath is the popup.
        if m.group(1).lower() == "unreleased" and not _section_has_items(chunk):
            continue
        first = chunk
        heading_name = m.group(1)
        break
    if first is None:
        return notes
    notes["heading"] = "Latest changes" if heading_name.lower() == "unreleased" else heading_name

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
