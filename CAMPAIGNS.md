# Campaign maintenance

Campaign folders live below `levels/`. After adding, removing, or renaming campaign level JSON files, run:

```bash
python3 tools/update_manifests.py
```

The command:

- scans root tutorial levels and every campaign folder;
- validates that every matching file contains valid JSON;
- requires campaign levels to start at 1, remain contiguous, and use one filename width;
- creates a default `campaign.json` when a campaign folder does not have one;
- updates `js/campaign_manifest.js` only when the level tree has changed;
- does not run Git commands or commit anything.

Review the generated changes with:

```bash
git status --short
git diff -- levels js/campaign_manifest.js
```

Then commit normally.

## Adding levels to an existing campaign

Add the next consecutive file or files to the campaign directory. For example:

```text
levels/Pokemon/level_1026.json
levels/Pokemon/level_1027.json
```

Run the updater. It derives the new level count automatically.

## Adding a campaign

Create a folder and add consecutively numbered files:

```text
levels/Animals/
├── level_001.json
├── level_002.json
└── level_003.json
```

Run the updater. It creates this metadata file when missing:

```json
{
  "name": "Animals",
  "description": "Animals levels in filename order."
}
```

Edit that metadata afterward when a different name or description is required, then run the updater again to validate it.

## Validation-only mode

Use this in a local check or CI job when files must not be modified:

```bash
python3 tools/update_manifests.py --check
```

Exit codes:

- `0`: manifests are current;
- `1`: manifests are missing or stale;
- `2`: the level tree or JSON is invalid.
