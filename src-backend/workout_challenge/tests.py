from unittest import mock

from django.test import TestCase, override_settings

from .release_notes import get_release_notes, parse_release_notes


SAMPLE = """# Changelog

All notable changes.

## [Unreleased]

### Added
- **Coach threads** — participants can `reply` to coach messages.
- Small thing.

### Fixed
- **A nasty bug** — it broke everything.

## [0.9.0] - 2026-01-01

### Added
- Ancient history.
"""


class ParseReleaseNotesTests(TestCase):
    """The popup's notes come from the first ## [...] section of
    CHANGELOG.md, shaped for a small screen."""

    def test_unreleased_section_becomes_latest_changes(self):
        notes = parse_release_notes(SAMPLE)
        self.assertEqual(notes["heading"], "Latest changes")

    def test_sections_and_items_are_parsed_and_markdown_stripped(self):
        notes = parse_release_notes(SAMPLE)
        titles = [s["title"] for s in notes["sections"]]
        self.assertEqual(titles, ["Added", "Fixed"])
        self.assertEqual(notes["sections"][0]["items"][0], "Coach threads — participants can reply to coach messages.")
        self.assertNotIn("**", str(notes["sections"]))
        self.assertNotIn("`", str(notes["sections"]))

    def test_version_heading_wins_when_present(self):
        text = SAMPLE.replace("## [Unreleased]", "## [1.2.3] - 2026-08-01", 1)
        notes = parse_release_notes(text)
        self.assertEqual(notes["heading"], "1.2.3")

    def test_item_cap_and_truncated_flag(self):
        text = "## [Unreleased]\n\n### Added\n" + "\n".join(f"- Item {i}" for i in range(30))
        notes = parse_release_notes(text)
        total = sum(len(s["items"]) for s in notes["sections"])
        self.assertEqual(total, 12)
        self.assertTrue(notes["truncated"])

    def test_empty_and_garbage_input(self):
        self.assertEqual(parse_release_notes(""), {"heading": "", "sections": [], "truncated": False})
        self.assertEqual(parse_release_notes("no headings here"), {"heading": "", "sections": [], "truncated": False})

    def test_missing_changelog_file_returns_empty_notes(self):
        from workout_challenge import release_notes
        with mock.patch.object(release_notes, "CHANGELOG_PATH") as fake:
            fake.stat.side_effect = OSError("missing")
            release_notes._cache.update({"mtime": None, "notes": None})
            self.assertEqual(get_release_notes(), {"heading": "", "sections": [], "truncated": False})


# DRF throttling reads the Django cache - LocMem so tests need no Redis.
@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}},
)
class ReleaseVersionEndpointTests(TestCase):
    """GET /api/version/ is public (the popup also works logged-out) and
    returns the release version plus the parsed notes."""

    def test_anonymous_gets_version_and_changelog_shape(self):
        response = self.client.get("/api/version/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("version", data)
        self.assertIn("changelog", data)
        self.assertIn("heading", data["changelog"])
        self.assertIn("sections", data["changelog"])

    def test_version_defaults_to_dev(self):
        response = self.client.get("/api/version/")
        self.assertEqual(response.json()["version"], "dev")
