from __future__ import annotations

import hashlib
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

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

    @staticmethod
    def manifest_revisions(content: str) -> dict[str, str]:
        return dict(re.findall(
            r'^\s+"([^"]+)": "([0-9a-f]{64})",?$',
            content,
            flags=re.MULTILINE,
        ))

    def test_creates_metadata_and_updates_manifests(self) -> None:
        temporary, root = self.make_repo()
        self.addCleanup(temporary.cleanup)
        self.write_level(root / "levels" / "level_001.json", 1)
        self.write_level(root / "levels" / "Animals" / "level_001.json", 1)
        self.write_level(root / "levels" / "Animals" / "level_002.json", 2)

        result = update_manifests.synchronize(root)

        self.assertTrue(result.changed)
        self.assertEqual(result.revision_count, 4)
        metadata_path = root / "levels" / "Animals" / "campaign.json"
        self.assertTrue(metadata_path.exists())
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
        self.assertEqual(metadata["name"], "Animals")

        manifest = (root / "js" / "campaign_manifest.js").read_text(
            encoding="utf-8"
        )
        self.assertIn(
            'folder: "Animals", level_count: 2, file_width: 3',
            manifest,
        )
        self.assertIn('"./levels/level_001.json"', manifest)

        revision_manifest = (
            root / "js" / "level_revision_manifest.js"
        ).read_text(encoding="utf-8")
        revisions = self.manifest_revisions(revision_manifest)
        self.assertEqual(set(revisions), {
            "./levels/level_001.json",
            "./levels/Animals/campaign.json",
            "./levels/Animals/level_001.json",
            "./levels/Animals/level_002.json",
        })
        expected_hash = hashlib.sha256(
            (root / "levels" / "Animals" / "level_002.json").read_bytes()
        ).hexdigest()
        self.assertEqual(
            revisions["./levels/Animals/level_002.json"],
            expected_hash,
        )
        self.assertRegex(
            revision_manifest,
            r'CHOOBS_LEVEL_MANIFEST_REVISION = "sha256:[0-9a-f]{64}"',
        )

    def test_only_changed_asset_revision_changes(self) -> None:
        temporary, root = self.make_repo()
        self.addCleanup(temporary.cleanup)
        level_1 = root / "levels" / "Animals" / "level_001.json"
        level_2 = root / "levels" / "Animals" / "level_002.json"
        self.write_level(level_1, 1)
        self.write_level(level_2, 2)

        update_manifests.synchronize(root)
        before = self.manifest_revisions(
            (root / "js" / "level_revision_manifest.js").read_text(
                encoding="utf-8"
            )
        )

        level_2.write_text(
            json.dumps({"number": 2, "changed": True}) + "\n",
            encoding="utf-8",
        )
        update_manifests.synchronize(root)
        after = self.manifest_revisions(
            (root / "js" / "level_revision_manifest.js").read_text(
                encoding="utf-8"
            )
        )

        self.assertEqual(
            before["./levels/Animals/level_001.json"],
            after["./levels/Animals/level_001.json"],
        )
        self.assertNotEqual(
            before["./levels/Animals/level_002.json"],
            after["./levels/Animals/level_002.json"],
        )
        self.assertEqual(
            before["./levels/Animals/campaign.json"],
            after["./levels/Animals/campaign.json"],
        )

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
        self.assertFalse(
            (root / "levels" / "Animals" / "campaign.json").exists()
        )
        self.assertFalse((root / "js" / "campaign_manifest.js").exists())
        self.assertFalse(
            (root / "js" / "level_revision_manifest.js").exists()
        )

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

        with self.assertRaisesRegex(
            update_manifests.ManifestError,
            "numbering gaps",
        ):
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

        with self.assertRaisesRegex(
            update_manifests.ManifestError,
            "filename widths",
        ):
            update_manifests.synchronize(root)


if __name__ == "__main__":
    unittest.main()
