# 50×50 and five-colour update

## Game

- The procedural grid ceiling is now 50×50.
- Level 50 is exactly 50×50.
- Levels 51 onward choose deterministic even sizes between 10×10 and 50×50.
- Level validation rejects dimensions above 50 in either axis.
- Procedural game levels resolve through a five-entry palette; custom levels may use one through five colours.
- Random procedural levels generate five seeded, strongly separated colours.
- Existing tutorial and older custom levels without a palette receive the default five-colour palette.

## Creator

- The editor is fixed at 50×50.
- Images are center-cropped and nearest-neighbour scaled to 50×50.
- Transparent pixels remain empty.
- A clearly dominant dark border colour remains empty background.
- Visible pixels can be reduced to one through five target colours.
- The extracted palette is shown in the editor.
- Every valid pixel is covered exactly once.
- Every pipe is constrained to one source-colour region.
- Full 50×50 masks use a fast deterministic exact-cover generator.
- Exported JSON includes the selected one-to-five-colour palette.

## PWA

- The original cache version for this release was `2026.07.30.1`; the palette popup update advances it to `2026.07.30.2`.
- Both game and creator assets are precached for offline use.

## Palette-selection popup update

- Uploaded creator images now open a quantisation dialog before replacing the active source.
- Automatic analysis chooses an appropriate palette containing one through five meaningful colours.
- Authors may select a manual count from one through five and edit exact hexadecimal colour targets.
- The popup provides a live authoritative 50×50 nearest-colour preview.
- Cancelling leaves the previous source unchanged.
- Custom levels preserve palettes containing fewer than five colours; procedural game levels continue to use exactly five.
- Duplicate manual target colours collapse to fewer effective palette entries.
- The repository now contains exactly one README file at `/README.md`.
- The palette-popup release used PWA cache version `2026.07.30.2`.

## Same-colour singleton endpoint merge

- The creator now performs a final colour-aware singleton cleanup after colour-region splitting and inside the fast 50×50 exact-cover generator.
- A one-cell pipe touching the start or end of another pipe with the same colour is merged when the resulting path obeys the five-cell straight-run rule and the complete puzzle remains solvable.
- Both target-pipe orientations are tested before a merge is rejected.
- The PWA cache version is now `2026.07.30.3`.
