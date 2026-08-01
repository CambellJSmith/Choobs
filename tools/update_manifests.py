#!/usr/bin/env python3
"""Synchronize Choobs campaign metadata and generated browser manifests."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Mapping, Sequence

LEVEL_FILE_PATTERN = re.compile(r"^level_(\d+)\.json$", re.IGNORECASE)
DEFAULT_FILE_WIDTH = 3
REVISION_ALGORITHM = "sha256"
CAMPAIGN_MANIFEST_PATH = Path("js/campaign_manifest.js")
LEVEL_REVISION_MANIFEST_PATH = Path("js/level_revision_manifest.js")


class ManifestError(RuntimeError):
    """Raised when the level tree cannot produce a safe manifest."""


@dataclass(frozen=True)
class Campaign:
    folder: str
    level_count: int
    file_width: int


@dataclass(frozen=True)
class Asset:
    browser_path: str
    source_path: Path | None
    generated_content: str | None = None

    def content_bytes(self) -> bytes:
        if self.generated_content is not None:
            return self.generated_content.encode("utf-8")
        if self.source_path is None:
            raise ManifestError(f"No source available for {self.browser_path}.")
        try:
            return self.source_path.read_bytes()
        except OSError as error:
            raise ManifestError(
                f"Could not read {self.source_path}: {error}"
            ) from error


@dataclass(frozen=True)
class SyncResult:
    created_files: tuple[Path, ...]
    updated_files: tuple[Path, ...]
    root_level_count: int
    campaign_level_count: int
    campaign_count: int
    revision_count: int

    @property
    def changed(self) -> bool:
        return bool(self.created_files or self.updated_files)


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Scan levels/, create missing campaign.json files, and synchronize "
            "js/campaign_manifest.js plus js/level_revision_manifest.js."
        )
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="report stale or missing manifests without writing files",
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=None,
        help="repository root; defaults to the parent of this script's tools directory",
    )
    return parser.parse_args(argv)


def repository_root(explicit_root: Path | None = None) -> Path:
    if explicit_root is not None:
        return explicit_root.expanduser().resolve()
    return Path(__file__).resolve().parents[1]


def display_name_from_folder(folder: str) -> str:
    leaf = Path(folder).name
    name = re.sub(r"[_-]+", " ", leaf)
    name = re.sub(r"\s+", " ", name).strip()
    return name or "Campaign"


def read_json_object(path: Path) -> dict[str, object]:
    try:
        with path.open("r", encoding="utf-8") as source:
            value = json.load(source)
    except json.JSONDecodeError as error:
        raise ManifestError(
            f"Invalid JSON in {path}: line {error.lineno}, column {error.colno}: "
            f"{error.msg}"
        ) from error
    except OSError as error:
        raise ManifestError(f"Could not read {path}: {error}") from error

    if not isinstance(value, dict):
        raise ManifestError(f"Expected a JSON object in {path}.")
    return value


def find_level_files(directory: Path) -> list[tuple[int, int, Path]]:
    levels: list[tuple[int, int, Path]] = []
    seen_numbers: dict[int, Path] = {}

    for path in sorted(directory.iterdir(), key=lambda item: item.name.casefold()):
        if not path.is_file():
            continue
        match = LEVEL_FILE_PATTERN.fullmatch(path.name)
        if not match:
            continue

        number_text = match.group(1)
        number = int(number_text)
        if number < 1:
            raise ManifestError(f"Level filenames must start at 1: {path}")
        if number in seen_numbers:
            raise ManifestError(
                f"Duplicate level number {number} in {directory}: "
                f"{seen_numbers[number].name} and {path.name}"
            )

        read_json_object(path)
        seen_numbers[number] = path
        levels.append((number, len(number_text), path))

    return sorted(levels, key=lambda item: (item[0], item[2].name.casefold()))


def validate_contiguous_campaign(
    campaign_directory: Path,
    levels: Sequence[tuple[int, int, Path]],
) -> tuple[int, int]:
    if not levels:
        return 0, DEFAULT_FILE_WIDTH

    numbers = [number for number, _, _ in levels]
    expected = list(range(1, numbers[-1] + 1))
    if numbers != expected:
        missing = sorted(set(expected) - set(numbers))
        missing_names = ", ".join(
            f"level_{number:03d}.json" for number in missing[:12]
        )
        if len(missing) > 12:
            missing_names += f", and {len(missing) - 12} more"
        raise ManifestError(
            f"Campaign {campaign_directory} has numbering gaps. Missing: "
            f"{missing_names}"
        )

    widths = {width for _, width, _ in levels}
    if len(widths) != 1:
        examples = ", ".join(path.name for _, _, path in levels[:8])
        raise ManifestError(
            f"Campaign {campaign_directory} mixes filename widths. "
            f"Rename files to one consistent width. Examples: {examples}"
        )

    return numbers[-1], widths.pop()


def campaign_metadata_content(folder: str) -> str:
    name = display_name_from_folder(folder)
    metadata = {
        "name": name,
        "description": f"{name} levels in filename order.",
    }
    return json.dumps(metadata, indent=2, ensure_ascii=False) + "\n"


def asset_from_path(root: Path, path: Path) -> Asset:
    relative = path.relative_to(root).as_posix()
    return Asset(browser_path=f"./{relative}", source_path=path)


def discover(
    root: Path,
) -> tuple[list[str], list[Campaign], dict[Path, str], int, list[Asset]]:
    levels_root = root / "levels"
    if not levels_root.is_dir():
        raise ManifestError(f"Missing levels directory: {levels_root}")

    root_levels = find_level_files(levels_root)
    root_paths = [f"./levels/{path.name}" for _, _, path in root_levels]
    assets = [asset_from_path(root, path) for _, _, path in root_levels]

    campaigns: list[Campaign] = []
    missing_metadata: dict[Path, str] = {}
    total_campaign_levels = 0

    candidate_directories: set[Path] = set()
    for current_root, directory_names, file_names in os.walk(levels_root):
        directory_names[:] = sorted(
            [name for name in directory_names if not name.startswith(".")],
            key=str.casefold,
        )
        current = Path(current_root)
        if current == levels_root:
            continue
        if "campaign.json" in file_names or any(
            LEVEL_FILE_PATTERN.fullmatch(name) for name in file_names
        ):
            candidate_directories.add(current)

    for directory in sorted(
        candidate_directories,
        key=lambda path: path.relative_to(levels_root).as_posix().casefold(),
    ):
        folder = directory.relative_to(levels_root).as_posix()
        metadata_path = directory / "campaign.json"
        if metadata_path.exists():
            metadata = read_json_object(metadata_path)
            for required_field in ("name", "description"):
                value = metadata.get(required_field)
                if not isinstance(value, str) or not value.strip():
                    raise ManifestError(
                        f"{metadata_path} must contain a non-empty string "
                        f'field named "{required_field}".'
                    )
            assets.append(asset_from_path(root, metadata_path))
        else:
            generated_metadata = campaign_metadata_content(folder)
            missing_metadata[metadata_path] = generated_metadata
            assets.append(
                Asset(
                    browser_path=f"./levels/{folder}/campaign.json",
                    source_path=None,
                    generated_content=generated_metadata,
                )
            )

        levels = find_level_files(directory)
        level_count, file_width = validate_contiguous_campaign(directory, levels)
        total_campaign_levels += level_count
        campaigns.append(
            Campaign(
                folder=folder,
                level_count=level_count,
                file_width=file_width,
            )
        )
        assets.extend(asset_from_path(root, path) for _, _, path in levels)

    assets.sort(key=lambda asset: asset.browser_path.casefold())
    return root_paths, campaigns, missing_metadata, total_campaign_levels, assets


def js_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def render_campaign_manifest(
    root_level_paths: Sequence[str],
    campaigns: Sequence[Campaign],
) -> str:
    lines = [
        '"use strict";',
        "",
        "// Generated by tools/update_manifests.py. Do not edit manually.",
        "(() => {",
        "    const files = [",
    ]

    for index, path in enumerate(root_level_paths):
        suffix = "," if index < len(root_level_paths) - 1 else ""
        lines.append(f"        {js_string(path)}{suffix}")

    lines.extend(["    ];", "    const campaigns = ["])

    for index, campaign in enumerate(campaigns):
        suffix = "," if index < len(campaigns) - 1 else ""
        lines.append(
            "        { "
            f"folder: {js_string(campaign.folder)}, "
            f"level_count: {campaign.level_count}, "
            f"file_width: {campaign.file_width} "
            f"}}{suffix}"
        )

    lines.extend(
        [
            "    ];",
            "",
            "    for (const campaign of campaigns) {",
            "        files.push(`./levels/${campaign.folder}/campaign.json`);",
            "",
            "        for (let level_number = 1; level_number <= campaign.level_count; level_number += 1) {",
            "            const file_number = String(level_number).padStart(",
            "                campaign.file_width,",
            '                "0"',
            "            );",
            "            files.push(",
            "                `./levels/${campaign.folder}/level_${file_number}.json`",
            "            );",
            "        }",
            "    }",
            "",
            "    globalThis.CHOOBS_CAMPAIGN_FILES = Object.freeze(files);",
            "})();",
            "",
        ]
    )
    return "\n".join(lines)


def sha256_hex(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def calculate_revisions(assets: Sequence[Asset]) -> dict[str, str]:
    revisions: dict[str, str] = {}
    for asset in assets:
        if asset.browser_path in revisions:
            raise ManifestError(f"Duplicate browser asset path: {asset.browser_path}")
        revisions[asset.browser_path] = sha256_hex(asset.content_bytes())
    return revisions


def revision_manifest_id(revisions: Mapping[str, str]) -> str:
    canonical = json.dumps(
        revisions,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return f"{REVISION_ALGORITHM}:{sha256_hex(canonical)}"


def render_level_revision_manifest(revisions: Mapping[str, str]) -> str:
    manifest_id = revision_manifest_id(revisions)
    lines = [
        '"use strict";',
        "",
        "// Generated by tools/update_manifests.py. Do not edit manually.",
        "(() => {",
        "    const revisions = Object.freeze({",
    ]
    items = sorted(revisions.items(), key=lambda item: item[0].casefold())
    for index, (path, revision) in enumerate(items):
        suffix = "," if index < len(items) - 1 else ""
        lines.append(f"        {js_string(path)}: {js_string(revision)}{suffix}")
    lines.extend(
        [
            "    });",
            "",
            f"    globalThis.CHOOBS_LEVEL_REVISION_ALGORITHM = {js_string(REVISION_ALGORITHM)};",
            f"    globalThis.CHOOBS_LEVEL_MANIFEST_REVISION = {js_string(manifest_id)};",
            "    globalThis.CHOOBS_LEVEL_REVISIONS = revisions;",
            "})();",
            "",
        ]
    )
    return "\n".join(lines)


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=path.parent,
        text=True,
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as output:
            output.write(content)
        temporary_path.replace(path)
    except BaseException:
        temporary_path.unlink(missing_ok=True)
        raise


def file_matches(path: Path, expected: str) -> bool:
    try:
        return path.read_text(encoding="utf-8") == expected
    except FileNotFoundError:
        return False
    except OSError as error:
        raise ManifestError(f"Could not read {path}: {error}") from error


def synchronize(root: Path, check: bool = False) -> SyncResult:
    root = root.resolve()
    root_paths, campaigns, missing_metadata, campaign_level_count, assets = discover(root)

    campaign_manifest_path = root / CAMPAIGN_MANIFEST_PATH
    revision_manifest_path = root / LEVEL_REVISION_MANIFEST_PATH
    expected_campaign_manifest = render_campaign_manifest(root_paths, campaigns)
    revisions = calculate_revisions(assets)
    expected_revision_manifest = render_level_revision_manifest(revisions)

    created: list[Path] = []
    updated: list[Path] = []

    for path, content in missing_metadata.items():
        created.append(path)
        if not check:
            atomic_write(path, content)

    generated_outputs = (
        (campaign_manifest_path, expected_campaign_manifest),
        (revision_manifest_path, expected_revision_manifest),
    )
    for path, expected in generated_outputs:
        if not file_matches(path, expected):
            if path.exists():
                updated.append(path)
            else:
                created.append(path)
            if not check:
                atomic_write(path, expected)

    return SyncResult(
        created_files=tuple(created),
        updated_files=tuple(updated),
        root_level_count=len(root_paths),
        campaign_level_count=campaign_level_count,
        campaign_count=len(campaigns),
        revision_count=len(revisions),
    )


def relative_paths(paths: Iterable[Path], root: Path) -> list[str]:
    return [path.relative_to(root).as_posix() for path in paths]


def print_result(result: SyncResult, root: Path, check: bool) -> None:
    for path in relative_paths(result.created_files, root):
        action = "Missing" if check else "Created"
        print(f"{action}: {path}")
    for path in relative_paths(result.updated_files, root):
        action = "Stale" if check else "Updated"
        print(f"{action}: {path}")

    print(
        f"Found {result.root_level_count} root level(s), "
        f"{result.campaign_level_count} campaign level(s), "
        f"{result.campaign_count} campaign(s), and "
        f"{result.revision_count} revision(s)."
    )
    if not result.changed:
        print("Manifests are already up to date.")


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    root = repository_root(args.repo_root)
    try:
        result = synchronize(root, check=args.check)
    except ManifestError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2

    print_result(result, root, args.check)
    if args.check and result.changed:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
