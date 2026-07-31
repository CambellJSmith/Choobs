from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import update_manifests


class UpdateManifestsTests(unittest.TestCase):
    def make_repo(self) -> tuple[tempfile.TemporaryDirectory[str], Path]:
        temporary = tempfile.TemporaryDirectory()
        root = Path(temporary.name)
        (root / "levels").mkdir()
        (root / "js").mkdir()
        return temporary, root

    @staticmethod
    def write_level(path: Path, number: int) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"number": number}) + "\n", encoding="utf-8")

    def test_creates_metadata_and_updates_manifest(self) -> None:
        temporary, root = self.make_repo()
        self.addCleanup(temporary.cleanup)
        self.write_level(root / "levels" / "level_001.json", 1)
        self.write_level(root / "levels" / "Animals" / "level_001.json", 1)
        self.write_level(root / "levels" / "Animals" / "level_002.json", 2)

        result = update_manifests.synchronize(root)

        self.assertTrue(result.changed)
        metadata_path = root / "levels" / "Animals" / "campaign.json"
        self.assertTrue(metadata_path.exists())
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        self.assertEqual(metadata["name"], "Animals")

        manifest = (root / "js" / "campaign_manifest.js").read_text(encoding="utf-8")
        self.assertIn('folder: "Animals", level_count: 2, file_width: 3', manifest)
        self.assertIn('"./levels/level_001.json"', manifest)

    def test_second_run_is_unchanged(self) -> None:
        temporary, root = self.make_repo()
        self.addCleanup(temporary.cleanup)
        self.write_level(root / "levels" / "Animals" / "level_001.json", 1)

        update_manifests.synchronize(root)
        result = update_manifests.synchronize(root)

        self.assertFalse(result.changed)

    def test_check_reports_without_writing(self) -> None:
        temporary, root = self.make_repo()
        self.addCleanup(temporary.cleanup)
        self.write_level(root / "levels" / "Animals" / "level_001.json", 1)

        result = update_manifests.synchronize(root, check=True)

        self.assertTrue(result.changed)
        self.assertFalse((root / "levels" / "Animals" / "campaign.json").exists())
        self.assertFalse((root / "js" / "campaign_manifest.js").exists())

    def test_rejects_numbering_gaps(self) -> None:
        temporary, root = self.make_repo()
        self.addCleanup(temporary.cleanup)
        campaign = root / "levels" / "Animals"
        campaign.mkdir()
        (campaign / "campaign.json").write_text(
            json.dumps({"name": "Animals", "description": "Animals."}),
            encoding="utf-8",
        )
        self.write_level(campaign / "level_001.json", 1)
        self.write_level(campaign / "level_003.json", 3)

        with self.assertRaisesRegex(update_manifests.ManifestError, "numbering gaps"):
            update_manifests.synchronize(root)

    def test_rejects_mixed_filename_widths(self) -> None:
        temporary, root = self.make_repo()
        self.addCleanup(temporary.cleanup)
        campaign = root / "levels" / "Animals"
        campaign.mkdir()
        (campaign / "campaign.json").write_text(
            json.dumps({"name": "Animals", "description": "Animals."}),
            encoding="utf-8",
        )
        self.write_level(campaign / "level_01.json", 1)
        self.write_level(campaign / "level_002.json", 2)

        with self.assertRaisesRegex(update_manifests.ManifestError, "filename widths"):
            update_manifests.synchronize(root)


if __name__ == "__main__":
    unittest.main()
