# Choobs — Complete Game and Level Creator Technical README

> **Documented builds**
>
> - Combined GitHub Pages build: 50×50 maximum, five-colour edition
> - Game and creator share the same version-3 palette-aware level format
>
> This document describes the actual files in those builds. It is intentionally excessive. It covers player-facing behavior, editor workflow, data formats, algorithms, persistence, PWA deployment, rendering, input, validation, and every named JavaScript function in the current source.

---

## Table of contents

1. [What Choobs is](#what-choobs-is)
2. [Repository and package layout](#repository-and-package-layout)
3. [Core puzzle rules](#core-puzzle-rules)
4. [Pipe representation and movement](#pipe-representation-and-movement)
5. [Concurrent movement and collision safety](#concurrent-movement-and-collision-safety)
6. [Game modes](#game-modes)
7. [Scoring and combo system](#scoring-and-combo-system)
8. [Progression and level resolution](#progression-and-level-resolution)
9. [Tutorial levels](#tutorial-levels)
10. [Procedural level generation](#procedural-level-generation)
11. [Blobby masks, holes, and warbled silhouettes](#blobby-masks-holes-and-warbled-silhouettes)
12. [Grid sizing and visual scale](#grid-sizing-and-visual-scale)
13. [Player input and gestures](#player-input-and-gestures)
14. [Game interface and overlays](#game-interface-and-overlays)
15. [Autosave and local persistence](#autosave-and-local-persistence)
16. [Offline PWA behavior](#offline-pwa-behavior)
17. [GitHub Pages deployment](#github-pages-deployment)
18. [iPhone and iPad installation](#iphone-and-ipad-installation)
19. [Manual levels and imported levels](#manual-levels-and-imported-levels)
20. [Level JSON format](#level-json-format)
21. [Level validation invariants](#level-validation-invariants)
22. [Level creator overview](#level-creator-overview)
23. [Creator image pipeline](#creator-image-pipeline)
24. [Creator generation controls](#creator-generation-controls)
25. [Exact mask coverage](#exact-mask-coverage)
26. [Creator play-test](#creator-play-test)
27. [Creator import and export](#creator-import-and-export)
28. [Shared engine architecture](#shared-engine-architecture)
29. [Rendering architecture](#rendering-architecture)
30. [Performance characteristics](#performance-characteristics)
31. [Accessibility and reduced motion](#accessibility-and-reduced-motion)
32. [Privacy and security](#privacy-and-security)
33. [Maintenance guide](#maintenance-guide)
34. [Testing checklist](#testing-checklist)
35. [Troubleshooting](#troubleshooting)
36. [Complete named-function reference](#complete-named-function-reference)
37. [DOM element reference](#dom-element-reference)
38. [CSS selector inventory](#css-selector-inventory)
39. [Glossary](#glossary)

---

# What Choobs is

Choobs is a grid-based pipe-removal puzzle. A level consists of a binary mask and a complete set of non-overlapping orthogonal pipe paths covering that mask. Every pipe has an arrow at one endpoint. Tapping a legal pipe causes the whole path to pull forward in the arrow direction until it has completely left the board.

The central puzzle is not merely finding pipes whose arrow points toward empty space. Pipes are intentionally curled around one another, and their arrow rays often meet other pipes at perpendicular angles. The level is therefore a dependency problem: remove currently clear pipes to expose the pipes that were aiming into them.

The current game is:

- a static HTML/CSS/JavaScript application;
- portrait-first and mobile-oriented;
- playable on ordinary desktop browsers;
- deployable on GitHub Pages;
- installable as an iOS/iPadOS Home Screen PWA without an Apple developer account;
- offline-capable after the first successful load;
- deterministic for procedural level generation;
- persistent through local browser storage;
- equipped with Freeplay, Heartbeat, and Permadeath modes;
- equipped with run scoring and a speed-based combo multiplier;
- equipped with one- and two-finger panning, pinch zoom, and two-finger reset gestures.

The creator is a separate standalone browser application. It center-crops and nearest-neighbour scales an uploaded image to 50×50, opens a quantisation popup, automatically proposes between one and five meaningful subject colours, permits manual selection of one to five target colours, preserves a binary occupancy silhouette, generates exact-cover colour-matched pipework, allows collision-safe play-testing, and exports self-contained level JSON.

## Doubled generated pipe lengths

All generated pipe-length targets are doubled relative to the previous build. This applies to procedural game levels, the creator’s Short/Medium/Long presets, the normal exact-cover generator, and the fast 50×50 fallback. Small residual regions may still require shorter repair pipes so exact mask coverage and solvability are preserved. The three hand-authored tutorial levels are unchanged.

## Current size and colour contract

- **50×50 is the absolute maximum** accepted by either engine.
- Procedural Levels 4–50 rise toward 50×50; Level 50 is exactly 50×50.
- Procedural Levels 51 onward choose a deterministic even size from 10×10 through 50×50.
- Every level carries a hexadecimal `palette` containing between one and five colours; procedural levels use exactly five.
- Procedural levels derive five strongly separated hues from the level-number seed.
- Tutorial or older levels without a palette receive the built-in five-colour fallback palette.
- Creator images are quantised to one through five target colours after center cropping and nearest-neighbour scaling. Automatic mode chooses an appropriate count up to five; manual mode lets the author set the count and exact target colours.
- A dominant dark border background and transparent pixels remain outside the valid mask.
- Creator pipes are split at source-colour boundaries, so every pipe has one palette colour and every occupied pixel retains its quantised colour assignment, regardless of whether the selected palette contains one, two, three, four, or five colours.

# Repository and package layout

The repository contains exactly one README file: this root `README.md`. The game and creator are deliberately independent. The creator does not navigate to the game, and the game does not require the creator. Their only formal interchange is the level JSON format.

## Repository root and game

```text
/
├── .nojekyll
├── README.md
├── DEPLOYMENT.md
├── CHANGELOG_50X50_FIVE_COLOUR.md
├── index.html
├── styles.css
├── manifest.webmanifest
├── service-worker.js
├── icon.svg
├── icon-180.png
├── icon-192.png
├── icon-512.png
├── levels/
│   ├── level_001.json
│   ├── level_002.json
│   └── level_003.json
├── js/
│   ├── levels.js
│   ├── engine.js
│   ├── procedural_levels.js
│   ├── canvas_renderer.js
│   ├── game.js
│   └── pwa.js
└── creator/
    ├── index.html
    ├── styles.css
    ├── creator.css
    └── js/
        ├── levels.js
        ├── engine.js
        ├── generation_worker_source.js
        ├── canvas_renderer.js
        └── creator.js
```

There is exactly one README file in the package, and it is located at `/README.md`.

### Game file responsibilities

- `index.html` defines the mobile game shell, HUD, board, result sheet, pause sheet, mode chooser, installation instructions, and PWA update/connection toasts.
- `styles.css` provides all layout, safe-area, touch target, animation, responsive, modal, score, combo, and reduced-motion styles.
- `js/levels.js` embeds the three bundled tutorial levels as JavaScript data so they are available without a fetch.
- `js/engine.js` owns the shared level format, validation, optional general generator, mutable puzzle session, movement, collision checks, and serialization.
- `js/procedural_levels.js` owns the game's level-number-seeded procedural generator.
- `js/canvas_renderer.js` owns fixed-cell canvas rendering, zoom-safe backing resolution, pipes, line arrows, mask, grid, guides, and effects.
- `js/game.js` owns the application state machine, input, progression, modes, score, autosave, imports, overlays, and animation loop.
- `js/pwa.js` owns installation UI, service-worker registration, online/offline messaging, and updates.
- `service-worker.js` owns application-shell precaching, runtime caching, offline navigation, JSON network-first behavior, and cache upgrades.
- `manifest.webmanifest` declares the installed app identity and icons.
- `.nojekyll` prevents GitHub Pages from applying Jekyll processing.
- `levels/level_001.json` through `level_003.json` are fixed tutorial levels.

## Creator folder

```text
creator/
├── index.html
├── styles.css
├── creator.css
└── js/
    ├── levels.js
    ├── engine.js
    ├── generation_worker_source.js
    ├── canvas_renderer.js
    └── creator.js
```

### Creator file responsibilities

- `index.html` defines the editor controls, preview, statistics, hidden compatibility elements, and hidden 50×50 source canvas.
- `styles.css` provides the shared dark application styling.
- `creator.css` provides creator-specific desktop workspace, sidebar, toolbar, preview, and responsive rules.
- `js/engine.js` is the creator's exact-cover-capable engine. It contains additional straight-run, orphan-repair, singleton-repair, and fixed-direction solution-order logic beyond the game engine.
- `js/generation_worker_source.js` contains a serialized worker program so the creator can start generation from a Blob without separate worker hosting.
- `js/canvas_renderer.js` renders the play-test preview and scales the entire 50×50 board into the available square.
- `js/creator.js` owns image decoding, preprocessing, generation controls, worker communication, play-test, import, export, and statistics.
- `js/levels.js` is an empty compatibility namespace in the standalone creator.

# Core puzzle rules

1. A level has `columns × rows` grid cells.
2. `mask[y * columns + x]` determines whether cell `(x, y)` belongs to the puzzle silhouette.
3. Every valid mask cell must be occupied by exactly one pipe cell.
4. Invalid mask cells must never contain pipe cells.
5. A pipe is an ordered list of orthogonally adjacent cells.
6. The final cell in the ordered list is the pipe head.
7. `direction` is a unit orthogonal vector: up, right, down, or left.
8. The open line-style arrow is drawn at the head and points along `direction`.
9. A stationary pipe can start only when no stationary pipe blocks its forward ray and its complete concurrent motion is safe relative to all moving pipes.
10. Once activated, every segment follows the next segment's previous position. The head advances one cell in the arrow direction.
11. The pipe continues until every one of its cells lies outside the grid.
12. The level completes when no active pipes remain.

The body of a pipe never branches and never crosses another pipe in the static level. Apparent tangling comes from close parallel contour-following, nested loops, perpendicular arrow aims, shared blockers, internal holes, and removal dependencies.

# Pipe representation and movement

A runtime pipe has:

```js
{
  id: Number,
  color_index: Number,
  cells: [{ x: Number, y: Number }, ...],
  direction: { x: -1|0|1, y: -1|0|1 },
  active: Boolean
}
```

The stored JSON representation uses arrays instead of objects:

```json
{
  "id": 12,
  "color_index": 4,
  "cells": [[11, 7], [12, 7], [12, 8]],
  "direction": [0, 1]
}
```

Movement is discrete at the logical level and interpolated at the visual level.

- Each moving pipe stores a fractional `progress` in `[0, 1)`.
- The session adds `deltaMilliseconds / move_duration`.
- Whenever progress reaches or exceeds 1, the pipe advances one full cell and progress is reduced by 1.
- All body cells shift toward their successor.
- The old head creates a new head one cell forward in `direction`.
- Rendering interpolates each cell toward its destination using quadratic ease-in/ease-out.
- After the last visible segment leaves the grid, the pipe becomes inactive and is removed from the moving set.

The movement duration is intentionally fast. Multiple legal pipes can move at the same time.

# Concurrent movement and collision safety

Choobs permits a pipe to start while other pipes are moving. This is not a simple "current occupancy" test. The engine checks the complete projected motion.

The safety pipeline is:

1. Reject missing, inactive, or already-moving pipes.
2. Scan the candidate's arrow ray for stationary blockers.
3. For every moving pipe, calculate a conservative swept-cell set.
4. If swept sets do not overlap, the pair cannot collide and detailed simulation is skipped.
5. If they overlap, simulate both pipes through future normalized time.
6. At sampled movement states, generate interpolated polylines.
7. Reject duplicate occupied cells.
8. Reject segment intersections and segment touching.
9. Reject line pairs whose minimum distance falls below the configured pipe separation.
10. Reject cases where pipes effectively swap through one another.

This allows safe convoys and simultaneous exits while preventing visual or logical crossing.

# Game modes

The player chooses a mode on first launch. The mode is stored on the device and can be changed from the pause menu.

## Freeplay

- Invalid blocked/collision taps have no gameplay penalty.
- The player may experiment indefinitely.
- Invalid taps still break the score combo.
- Empty-space taps do nothing.
- Tapping a pipe already moving reports that state but is not counted as a Heartbeat/Permadeath mistake.

## Heartbeat

- The player has three safe invalid pipe taps per level attempt.
- Only blocked or unsafe-collision pipe activations count.
- The heart HUD marks each mistake.
- On the third mistake, the current level enters a short failure state and resets.
- Score earned during that level attempt rolls back to the score at level start.
- Completed-level progression remains intact.

## Permadeath

- The same three invalid activations are allowed.
- On the third mistake, the complete run is lost.
- Completed-level progression is cleared.
- Run score and best combo are cleared.
- Procedural in-memory cache is cleared.
- The game returns to Level 1.
- Imported/manual level data remains available.
- The selected mode remains Permadeath unless the player changes it or performs Reset Game.

## Changing mode

Changing mode from the pause menu:

- retains the current board;
- retains progression;
- retains run score;
- resets current invalid-attempt hearts;
- persists the new choice immediately.

`Reset game` is the operation that removes progression and returns to the first-run mode chooser.

# Scoring and combo system

The score is a run total, not an isolated per-level score.

## Base score

A valid pipe activation awards:

```text
base points = number of cells in the pipe
```

A 17-cell pipe has 17 base points.

## Combo

If a valid pipe is activated before the current combo deadline:

```text
new combo = previous combo + 1
```

Otherwise:

```text
new combo = 1
```

Points awarded are:

```text
awarded points = pipe cell count × combo multiplier
```

Examples:

- 8-cell pipe at ×1: 8 points.
- 8-cell pipe at ×2: 16 points.
- 21-cell pipe at ×7: 147 points.

There is no fixed multiplier cap.

## Combo timing

The timer is:

```text
combo window = max(760 ms, 2400 ms - (combo - 1) × 80 ms)
```

The first continuation window is generous. Higher combos require progressively faster valid decisions. At sufficiently high values, the window remains fixed at 760 ms.

## Combo-ending events

- A blocked or collision-invalid pipe tap ends the combo immediately.
- Timer expiry ends the combo.
- Restarting a level ends the combo.
- Loading another level ends the combo.
- Empty-space taps do not end it.
- Panning and zooming do not end it.
- Pausing freezes the combo deadline by shifting it forward when play resumes.

## Score rollback

At level load, `level_score_start` records the run score. Restarting that level, including a Heartbeat failure, restores the run score to that value. This prevents score farming by repeatedly activating the same pipes and restarting.

## Score persistence

Score is stored both in a dedicated versioned score record and inside the active-board autosave. This redundancy allows consistent restoration if the browser closes during a partially completed level.

# Progression and level resolution

Progression is strictly sequential.

- The completed-level set contains level numbers.
- The resume frontier is the first positive integer not completed.
- Any level number at or below the frontier is selectable.
- Later levels are locked.
- Completed levels remain replayable.
- Completion unlocks the next numerical level.

For any number, the game resolves data in this exact order:

1. User-imported manual level from localStorage.
2. `levels/level_NNN.json` loaded from the hosted `levels` folder.
3. Embedded tutorial/manual fallback data.
4. Cached procedural level generated earlier in the session.
5. Fresh deterministic procedural generation from the level number.

The hosted level directory is resolved relative to `js/game.js`, not relative to the domain root. For example, a game deployed at `/Choobs/` requests `/Choobs/levels/level_004.json`. Moving the complete game folder to another repository path therefore does not require changing the source code.

A creator-authored folder JSON file overrides embedded tutorial data and the procedural level of the same number. A locally imported level intentionally has the highest priority for that browser.

# Tutorial levels

Levels 1–3 are fixed manual tutorial levels and are precached for offline use.

## Level 1 — First Pull

- 10×10.
- One nine-cell squiggly pipe.
- No blockers.
- Teaches that the arrowed pipe is tapped and pulled off the board.

## Level 2 — The Blocker

- 10×10.
- A horizontal pipe aims into a vertical perpendicular pipe, visually resembling a T.
- Intended order: vertical blocker first, horizontal pipe second.
- Teaches perpendicular blocking.

## Level 3 — Three Deep

- 12×12.
- Three pipes.
- Intended order: Pipe 2, then Pipe 1, then Pipe 0.
- Teaches a multi-step dependency chain.

Procedural generation begins at Level 4.

# Procedural level generation

The game-specific generator is deterministic and keyed only by the level number. Reopening a procedural level reconstructs the same dimensions, mask, pipes, directions, and solution order.

The generator has two conceptual phases:

1. Build a highly interlocked full source layout along a transformed Hilbert-style space-filling curve.
2. Select/crop complete pipes according to a deterministic organic mask so the final level is a blobby silhouette rather than a square.

## Size progression

For Levels 1–50, both ends of the allowed size band rise with level number.

- Early procedural levels are roughly 10×10–18×18.
- Midgame levels draw from progressively larger bands.
- Level 50 is explicitly 50×50.
- From Level 51 onward, each level deterministically chooses any even size from 10×10 through 50×50.

The current generator uses square procedural dimensions (`columns === rows`) but the occupied mask is not a full square.

## Nested source curve

The base route is a Hilbert-style curve because it:

- visits every source-grid cell once;
- has frequent turns;
- places distant path intervals near one another spatially;
- naturally produces contour-following and nested geometry;
- can be transformed and reversed without losing continuity.

The generator tries rotations/reflections, curve direction, and pipe target lengths. It partitions the curve into pipes while scoring:

- turn density;
- maximum straight run;
- aimed endpoints;
- perpendicular first contacts;
- multiple arrows sharing target pipes;
- number of blockers along rays;
- dependency depth;
- length consistency;
- wrap contacts.

No generated pipe may contain a straight run longer than five cells.

# Blobby masks, holes, and warbled silhouettes

The procedural board rectangle is only a coordinate container. The actual valid-cell mask is formed from complete pipes.

The mask process intentionally avoids clipping a pipe because clipping could:

- break continuity;
- invalidate its arrow endpoint;
- create uncovered cells;
- destroy the stored solution order;
- weaken perpendicular blocker relationships.

Instead, the generator retains or removes whole pipes.

The organic scalar field combines:

- coarse lobe noise;
- finer edge noise;
- radial falloff;
- directional warping;
- edge dents;
- internal hole fields;
- deterministic level-number seed mixing.

Candidate selection then:

- chooses pipes favored by the field;
- keeps a connected pipe component;
- adjusts retained area toward a target ratio;
- attempts whole-pipe enclosed-hole carving;
- measures perimeter and bounding-box fill;
- rejects near-rectangular results;
- requires at least one enclosed hole for grids 14×14 and larger;
- tries multiple deterministic crop and blob variants;
- scores the surviving interlocking structure.

The final mask contains every cell occupied by retained pipes and no others. Therefore it has exact coverage by construction.

# Grid sizing and visual scale

Procedural grid dimensions vary, but logical cell size in the game is fixed:

```text
12 CSS pixels per cell
```

The canvas adds 14 CSS pixels of padding on each side.

Examples:

- 10×10 board content: 120×120 CSS pixels; with padding: 148×148.
- 50×50 board content: 1200×1200 CSS pixels; with padding: 1228×1228.

Small levels do not stretch to fill the screen. Large levels do not shrink to fit. The board viewport scrolls/pans.

The visible canvas is CSS-scaled for zoom. The backing bitmap uses:

- device pixel ratio capped at 1.5;
- a nine-million-pixel maximum;
- a minimum render scale of 0.75.

This separates visual zoom from memory consumption.

# Player input and gestures

## Mouse

- Hovering a pipe shows pointer cursor and clear/blocked guidance.
- A press/release without moving at least 9 CSS pixels activates the pipe.
- A moved mouse gesture is not treated as a tap.

## One-finger touch

- Touch-down begins a pan gesture.
- Movement of at least 8 CSS pixels marks it as panning.
- Board scroll offsets follow the finger.
- A stationary touch that began on the canvas becomes a pipe activation.

## Two-finger touch

- Starting two pointers captures initial distance, midpoint, zoom, and board anchor.
- Moving the midpoint pans.
- Changing distance zooms.
- Translation and scaling can occur simultaneously.
- The logical board point beneath the midpoint remains anchored.
- Pinch/pan gestures suppress accidental pipe activation.

## Zoom range

The renderer clamps zoom to:

```text
0.02× through 512×
```

That is 2% through 51,200%.

## Double two-finger tap

Two two-finger taps within 460 ms and 72 CSS pixels:

- reset zoom to 100%;
- recenter the board;
- autosave the new view;
- produce light haptic feedback.

# Game interface and overlays

## Top HUD

- Choobs brand mark and name.
- Level selector with completion and lock states.
- Heart meter in Heartbeat/Permadeath.
- Hamburger pause button.

## Score stack

- Run score chip.
- Combo multiplier.
- Combo countdown bar.
- Point bursts at valid tap coordinates.

## Board surface

- Scrollable/pannable stage.
- Fixed-cell canvas.
- Loading overlay.
- Completion sheet.
- Canvas visual effects.

## Completion sheet

Displays:

- level complete;
- run score;
- points earned during the completed level;
- best combo achieved in the run;
- Next level;
- Replay.

## Pause sheet

Offers:

- Resume.
- Restart level.
- Change game mode.
- Reset game with confirmation.
- Install Choobs when available.
- Close Choobs.

## Mode chooser

First-run modal with Freeplay, Heartbeat, and Permadeath descriptions.

## Close screen

Confirms that progress has been saved. It remains as a fallback when the browser refuses to close a tab.

## Install overlay

Shows iOS Safari instructions for Add to Home Screen.

## PWA toasts

- Update ready / Restart.
- Offline mode.
- Connection restored.

# Autosave and local persistence

Choobs stores no server-side account data. All progress is local to the browser profile.

## `choobs_game_mode`

String:

```text
freeplay | heartbeat | permadeath
```

## `choobs_completed_levels`

JSON array of completed numeric level IDs.

## `choobs_imported_levels_v1`

JSON array of serialized manual levels imported through file input, drag-and-drop, or Alt+I.

## `choobs_score_state_v1`

```json
{
  "version": 1,
  "run_score": 12345,
  "level_score_start": 11820,
  "level_number": 27,
  "best_combo": 14
}
```

## `choobs_autosave_v1`

```json
{
  "version": 1,
  "saved_at": 0,
  "reason": "line_click_valid",
  "level_number": 27,
  "game_mode": "heartbeat",
  "invalid_attempts": 1,
  "pending_penalty": null,
  "run_score": 12345,
  "level_score_start": 11820,
  "best_combo": 14,
  "board_zoom": 1.75,
  "board_scroll": {
    "left": 430,
    "top": 170
  },
  "session": {
    "move_count": 31,
    "completed_pipe_count": 29,
    "pipes": [],
    "moving_pipes": []
  }
}
```

The session pipe array stores exact current cells, direction, color, ID, and active state. Moving entries store a fractional progress below 1.

Autosave occurs after:

- every valid line tap;
- every invalid line tap;
- pause open;
- pause close;
- mode change;
- mode selection;
- board pan completion;
- pinch completion;
- zoom reset;
- level load;
- level restart;
- visibility change;
- pagehide;
- beforeunload;
- close-app action.

Completed sessions remove the transient board autosave because progression and score are already separately committed.

# Offline PWA behavior

`service-worker.js` uses build version `2026.07.29.7`.

## Static cache

The static cache precaches:

- root navigation;
- HTML;
- CSS;
- manifest;
- all icons;
- all JavaScript;
- all three tutorial JSON files.

## Runtime cache

Runtime cache stores:

- successful navigations;
- successfully loaded manual level JSON;
- uncached same-origin assets.

## Fetch strategies

- Navigation: network/preload first, then exact cache, then cached `index.html`.
- JSON: network first, cache fallback.
- Other same-origin GET assets: cache first with background refresh.
- Cross-origin requests: untouched.
- Non-GET requests: untouched.

## Upgrade behavior

Changing `BUILD_VERSION` changes static and runtime cache names. On activation, older caches beginning with `choobs-pwa-` are removed. An update-ready UI sends `SKIP_WAITING`; controller change reloads the page.

LocalStorage is independent of Cache Storage, so application updates do not intentionally erase progress.

# GitHub Pages deployment

1. Create a GitHub repository.
2. Put the contents of `choobs_game/` at the Pages publishing root.
3. Commit and push.
4. Open repository Settings → Pages.
5. Select the desired branch and folder.
6. Wait for the HTTPS URL.
7. Open it once online to populate the offline cache.

All URLs are relative, so both of these patterns work:

```text
https://username.github.io/
https://username.github.io/choobs/
```

When adding a new bundled file:

1. Add it to the repository.
2. Add its relative path to `APP_SHELL`.
3. Increment `BUILD_VERSION`.
4. Deploy.

When adding manual level files, they do not have to be in `APP_SHELL`; the game loads and runtime-caches them as needed. Add them to `APP_SHELL` only when they must be guaranteed available on the first offline launch.

# iPhone and iPad installation

No Mac, Xcode, App Store account, or Apple developer membership is required for Home Screen installation.

1. Open the GitHub Pages URL in Safari.
2. Open the Choobs menu and choose Install Choobs, or use Safari Share.
3. Choose Add to Home Screen.
4. Confirm Add.
5. Launch from the Home Screen.

The manifest and Apple metadata request standalone presentation. iOS still controls some system UI and lifecycle behavior. `Close Choobs` can save state but cannot guarantee terminating the app because browsers restrict scripts from closing windows they did not open.

# Manual levels and imported levels

## Hosted manual levels

Naming convention:

```text
levels/level_001.json
levels/level_002.json
levels/level_125.json
```

The number is zero-padded to at least three digits in the filename. The `number` inside the file must match the requested number.

The `levels` directory must remain a sibling of the `js` directory:

```text
site-root/
├── index.html
├── js/
│   └── game.js
└── levels/
    └── level_NNN.json
```

The loader constructs the level URL from the actual deployed URL of `js/game.js`. It therefore works at a domain root, a GitHub Pages repository path such as `/Choobs/`, or another nested deployment folder.

## Local imported levels

The hidden file input supports multiple JSON files. The same import routine is reachable through:

- the file input programmatically;
- Alt+I;
- dropping `.json` files on the page.

Imported levels are validated and stored in localStorage. A later import of the same level number replaces the earlier one.

# Level JSON format

Current generated levels use version 3. Tutorial files use version 2 and remain compatible.

```json
{
  "version": 3,
  "number": 42,
  "name": "Example",
  "source_name": "custom image",
  "created_at": "2026-07-30T00:00:00.000Z",
  "palette": ["#ff5c7a", "#ffd166", "#4dd6a8", "#5b9dff", "#b983ff"],
  "columns": 50,
  "rows": 50,
  "mask": [0, 1, 1, 0],
  "pipes": [
    {
      "id": 0,
      "color_index": 0,
      "cells": [[10, 10], [11, 10], [11, 11]],
      "direction": [0, 1]
    }
  ],
  "solution_order": [0],
  "settings": {},
  "difficulty": {
    "pipe_count": 1,
    "segment_count": 3,
    "initially_open": 1,
    "dependency_depth": 1,
    "average_pipe_length": 3
  }
}
```

## Top-level fields

- `version`: format/version marker.
- `number`: positive integer used for ordering and overrides.
- `name`: display name for manual levels.
- `source_name`: image or generator description.
- `created_at`: informational timestamp.
- `palette`: exactly five distinct `#rrggbb` colours; missing or malformed entries are completed from the fallback palette.
- `columns`, `rows`: integer grid dimensions from 4 through 50.
- `mask`: row-major binary array of length `columns × rows`.
- `pipes`: complete non-overlapping path list.
- `solution_order`: pipe IDs in a valid sequential solution.
- `settings`: free-form generation metadata.
- `difficulty`: calculated summary; optional on input.

## Cell indexing

```text
index = y × columns + x
x = index mod columns
y = floor(index / columns)
```

## Direction vectors

Allowed:

```json
[0, -1]
[1, 0]
[0, 1]
[-1, 0]
```

Diagonal and zero directions are invalid.

# Level validation invariants

The validator throws on any violation.

- Dimensions are integers from 4 to 50.
- Mask length exactly matches area.
- Pipe IDs are unique.
- Each pipe contains at least one cell.
- Every pipe cell coordinate is an integer and lies inside the grid in stored level data.
- Every pipe cell lies on a valid mask cell.
- No two pipes occupy the same cell.
- Consecutive cells have Manhattan distance exactly 1.
- A pipe may not self-overlap.
- Direction is one orthogonal unit vector.
- Straight-run limits are enforced by the current engines.
- The complete mask is covered according to the build's coverage rules; the creator exact-cover build requires every valid cell.
- `solution_order` references valid pipe IDs without inappropriate duplication.
- Replaying the solution order must remove the level successfully.
- Difficulty is recalculated when not supplied.

# Level creator overview

The creator is designed for producing manual 50×50 levels.

Workflow:

1. Choose level number and name.
2. Upload an image or use the built-in mask.
3. Adjust average pipe length.
4. Adjust nesting.
5. Set or randomize a seed.
6. Generate preview.
7. Play-test.
8. Export JSON.
9. Put the JSON in the game's `levels` folder or import it in the game.

# Creator image pipeline

The browser-supported file input uses `accept="image/*"`. Actual formats depend on browser codecs, normally including PNG, JPEG, GIF, WebP, BMP, and often AVIF.

For an uploaded image:

1. Decode with `createImageBitmap` when available, with an `Image`/object-URL fallback.
2. Find `crop_size = min(width, height)` and center-crop the source to a square.
3. Draw that square to a **50×50** canvas with `imageSmoothingEnabled = false`; this is nearest-neighbour sampling, with no interpolation or blended resampling.
4. Inspect the 196 border cells. When at least 28% of the border belongs to one dark colour bucket, treat pixels within RGB distance 34 of that colour as background. Pixels with alpha below 64 are always background.
5. Mark all remaining pixels as valid occupancy cells.
6. Build a 5-bit-per-channel colour histogram for the visible pixels.
7. Produce an automatic proposal containing between one and five meaningful colours. The analysis begins with the largest cluster, adds sufficiently separated clusters, refines them with weighted k-means, merges near-duplicates, and discards negligible clusters.
8. Open the quantisation popup. The user may accept the automatic proposal or select a manual count from one through five and edit the target hexadecimal colours.
9. Render a live 50×50 preview by assigning every visible source pixel to its nearest selected target colour.
10. On Apply, store the binary mask, the selected one-to-five-entry palette, and one colour index per valid cell. On Cancel, retain the previous source unchanged.

The output is therefore not a black-and-white threshold. It is a 50×50 occupancy silhouette plus a quantised image using no more than five colours. Transparent or clearly dominant dark-border background cells remain empty. Other pixels are covered exactly once by pipework.

Palette-aware image generation uses a deterministic exact-cover frontier algorithm. It grows each path within one quantised source-colour region, biases turns and proximity according to the nesting control, and chooses path targets from the pipe-length control. Each exported pipe has one `color_index`, every one of its cells originated from that colour region, and a full 50×50 image completes without the expensive orphan-search behavior of the legacy uncoloured generator.

## Quantisation palette popup

Immediately after an image is decoded, centre-cropped, and nearest-neighbour scaled to 50×50, the creator opens a modal palette-selection workflow before changing the active source. The dialog contains a live pixelated preview and the following controls:

- **Use auto colours** restores the palette proposed by image analysis.
- **Number of target colours** accepts any value from one through five.
- Each active colour has a native colour picker and an editable six-digit hexadecimal field.
- **Apply quantisation** commits the preview as the creator source.
- **Cancel** leaves the previous creator source unchanged.
- Escape or tapping the dark backdrop also cancels.

Automatic selection is not forced to return five colours. It begins with the dominant visible colour, adds materially separated colour clusters, merges near-duplicates, and discards clusters that occupy only a negligible part of the subject. A naturally monochrome image can therefore produce one colour, while a complex image may use all five. Manual palettes are also capped at five and may contain fewer. Duplicate manual targets collapse to one effective palette entry.

The live preview uses the exact same nearest-colour assignment that will be saved into `current_color_map`, so the dialog preview is authoritative rather than illustrative. Background detection occurs before palette selection: transparent pixels and a clearly dominant dark border colour remain outside the valid mask and are not quantised into pipes.

# Creator generation controls

## Level number

- Minimum 1.
- Maximum 9999.
- Used in JSON and exported filename.

## Level name

- Up to 80 characters.
- Falls back to `custom level`.

## Average pipe length

Three values:

- Short.
- Medium.
- Long.

These map into engine length ranges and influence target path length, not a rigid length for every pipe.

## Pipe nesting

Four labels:

- Relaxed.
- Natural.
- Nested.
- Dense nest.

The exact-cover creator applies a high minimum effective nesting internally, then increases it further with this control. It rewards side-by-side contour following, structural turns, wrapping, and enclosed relationships.

## Seed

Unsigned 32-bit value. The same mask, settings, and successful attempt seed produce the same generation. If an attempt fails, later retries derive new seeds by adding a fixed 32-bit increment.

# Exact mask coverage

The creator passes:

```js
preserve_exact_mask: true
```

Consequences:

- Mask cleanup is bypassed.
- Even isolated visible pixels are retained.
- Every white cell is covered.
- Black cells remain empty.
- Styling requirements do not allow deleting mask cells.
- The attempt count is reduced for large exact masks to keep generation practical.
- Singleton or small fallback pipes are permitted when geometry makes them mathematically necessary.
- After colour-region splitting, every one-cell pipe is checked against the start and end of every same-colour pipe.
- When a continuous merged path can preserve the five-cell straight-run limit and a solvable dependency order, the singleton is absorbed into that neighbouring pipe.
- Both orientations of the neighbouring pipe are tested, so the cleanup may reverse the target path before accepting the merge.
- A singleton remains separate only when every applicable endpoint merge would violate pipe geometry, self-intersect its exit ray, or make the level unsolvable.
- Straight-run split/repair logic still attempts to preserve the five-cell limit.
- The exported settings record covered count and zero uncovered cells.

The generator's priority order is:

1. Correct exact coverage.
2. Valid non-overlap and continuity.
3. Solvability.
4. Straight-run compliance.
5. Dense nesting and turn quality.
6. Preferred average length.

Style may degrade locally to satisfy the higher-priority invariants.

# Creator play-test

The preview is a real `PuzzleSession`, not a static illustration.

- Hover shows whether a pipe is clear.
- Clicking activates through the same concurrent collision logic as the game.
- Multiple pipes can move simultaneously.
- Blocked taps identify both attempted pipe and blocker.
- Hint highlights a currently removable pipe.
- Reset test restores the generated level without changing seed or regenerating.
- Show mask toggles the valid-cell background.
- Statistics update during test:
  - valid cells;
  - pipe count;
  - open/removable count;
  - dependency depth.

The creator renderer scales the whole board into the available preview square. Unlike the game renderer, it does not use fixed 12-pixel cells or player pinch zoom.

# Creator import and export

## Export

The creator:

1. Synchronizes current number/name/settings.
2. Normalizes and serializes the level.
3. Builds formatted JSON.
4. Creates a Blob.
5. Creates a temporary object URL.
6. Triggers download.
7. Names the file `level_NNN.json`.
8. Revokes the object URL.

## Import

The creator:

1. Reads the selected file as text.
2. Parses JSON.
3. Normalizes and validates it.
4. Restores mask, metadata, pipe-length/nesting/seed controls.
5. Starts play-test.

The creator is standalone. It does not persist a server-side level library, and the hidden delete/library elements are compatibility remnants.

# Shared engine architecture

Both applications expose an immutable API as `globalThis.Choobs`.

Game engine exports:

- `DIRECTIONS`
- `PIPE_COLORS`
- `LENGTH_RANGES`
- `SeededRandom`
- `Grid`
- `PuzzleSession`
- `calculate_difficulty`
- `clean_mask`
- `create_seed`
- `generate_level`
- `normalize_level`
- `resize_mask`
- `serialize_level`
- `validate_level`

Creator engine additionally exports `MAX_STRAIGHT_CELLS`.

The game uses its specialized `ChoobsProceduralLevels` generator for automatic levels. The generic `Choobs.generate_level` remains useful for image-mask generation and validation. The creator uses its enhanced exact-cover generic generator.

# Rendering architecture

Rendering uses Canvas 2D.

## Static background cache

The renderer keeps a separate offscreen canvas for:

- board background;
- valid mask;
- static grid.

It is regenerated only when necessary.

## Per-frame dynamic rendering

Each frame draws:

- current interpolated pipe polylines;
- outer and inner strokes;
- open line-style arrows;
- hover/hint/blocked/blocker states;
- exit guides;
- speed streaks;
- moving tips;
- ripples;
- launch impulses;
- impacts;
- exit bursts;
- completion celebration.

## Pipe appearance

Pipes use the level's five-colour palette and a darker outline. Procedural palettes are seeded high-contrast hues; creator palettes come from the uploaded image. The arrow is not a filled triangle. It is drawn as an open line-tool structure aligned to the pipe's direction.

# Performance characteristics

- Procedural generation is deterministic and synchronous in the game, deferred by one animation frame before heavy work.
- Creator generation uses a Web Worker when available. Large exact 50×50 masks use a deterministic linear-time frontier cover rather than the expensive small-mask nest search.
- Creator passes both the occupancy mask and colour-index map as transferable buffers.
- Occupancy arrays use typed arrays.
- Generator remaining-cell lists maintain index-position maps for O(1) removal.
- Collision uses conservative swept-set rejection before detailed simulation.
- Static board drawing is cached.
- Effects are capped at 120.
- Device pixel ratio is capped.
- Backing-canvas area is capped.
- Procedural levels are cached in memory.
- Manual-file fetch promises are cached to avoid repeat 404 checks.
- Service worker caches static and runtime assets.
- Autosave uses compact JSON and only active level state.

# Accessibility and reduced motion

- Major controls are native buttons/selects.
- Modal surfaces use `role="dialog"` and `aria-modal`.
- Reset uses `role="alertdialog"`.
- Status and PWA toasts use live regions.
- Canvas has an accessible label and keyboard focus target.
- Heart meter has a dynamic textual label.
- Screen-reader-only status reports interactions.
- Reduced-motion preference suppresses or compresses many effects and delays.
- Focus is moved deliberately when opening/closing modal UI.
- Touch targets are sized for mobile use.
- Safe-area insets accommodate notches and Home indicators.

The puzzle itself remains primarily visual and pointer-driven; a complete nonvisual pipe-navigation interface is not currently implemented.

# Privacy and security

- No analytics.
- No accounts.
- No remote save service.
- No advertising SDK.
- No third-party runtime libraries.
- No cross-origin fetch logic.
- Local data stays in browser storage unless the user exports/imports files.
- Service worker ignores cross-origin requests.
- Imported JSON is parsed and validated before use.
- Image decoding happens locally in the creator.
- The creator never uploads source images.

# Maintenance guide

## Change game name

Search visible HTML, manifest, metadata, icons, storage-key migration, README, and service-worker cache prefix. Changing storage keys without migration loses apparent progress.

## Add a gameplay feature

Usually edit:

- `js/game.js` for state/input/UI.
- `index.html` for controls.
- `styles.css` for presentation.
- `js/canvas_renderer.js` for board visuals.
- `service-worker.js` APP_SHELL/version if files change or are added.

## Change procedural generation

Edit `js/procedural_levels.js`. Preserve:

- deterministic seeding;
- complete mask coverage;
- legal paths;
- max straight run;
- valid solution order;
- manual override precedence;
- performance at 50×50.

## Change shared movement rules

Update both game and creator `js/engine.js`, then test concurrent movement in both applications. These files are similar but not identical; do not blindly overwrite the creator engine with the game engine.

## Change level format

Update:

- `normalize_level`
- `validate_level`
- `serialize_level`
- creator import/export
- manual tutorial data
- autosave compatibility if mutable runtime structure changes
- documentation
- service-worker build version if deployed assets change

## Update PWA

Increment `BUILD_VERSION`. Confirm APP_SHELL contains every required first-offline-launch asset.

# Testing checklist

## Game startup

- Fresh storage shows mode chooser.
- Returning storage bypasses chooser.
- Level 1 loads.
- Tutorial manual files work online and offline.

## Modes

- Freeplay never counts blocked taps.
- Heartbeat resets exactly on third blocked/collision tap.
- Heartbeat score rolls back.
- Permadeath clears progression and score.
- Changing mode clears hearts but retains board.

## Score

- Valid activation base equals original pipe cell count.
- Multipliers increase before deadline.
- Timer minimum is 760 ms.
- Invalid blocked tap breaks combo.
- Empty tap does not.
- Restart rolls score back.
- Completion shows correct level points.
- Autosave restores score.

## Input

- Mouse click activates.
- Mouse drag does not.
- One finger pans.
- Stationary one-finger tap activates.
- Two fingers pan with constant distance.
- Two fingers zoom when distance changes.
- Combined pan/zoom anchors midpoint.
- Double two-finger tap resets.
- Pinch never activates a pipe.

## Procedural generation

- Level 4 is nonrectangular.
- Level 14×14+ has an enclosed hole.
- Level 50 is 50×50.
- Level 51+ samples full size range.
- Same level number reproduces identical JSON.
- Straight run never exceeds five.
- Solution order completes.
- Manual JSON overrides.

## Autosave

- Save after valid tap.
- Save after invalid tap.
- Save active moving progress.
- Restore zoom and pan.
- Restore strikes.
- Reject incompatible snapshot.
- Completion clears board autosave.

## PWA

- First online load caches shell.
- Reload offline works.
- Tutorial files work offline.
- Procedural levels work offline.
- Manual JSON cached after online load works offline.
- Build-version update shows prompt.
- Restart activates new service worker.
- Progress survives update.

## Creator image pipeline

- Landscape image center-crops.
- Portrait image center-crops.
- Square image remains centered.
- PNG/JPEG/WebP decode.
- Smoothing is disabled.
- Transparent regions remain outside the occupancy mask.
- Output is exactly 50×50.
- Quantisation popup appears before the source is committed.
- Auto mode may choose one, two, three, four, or five colours.
- Manual mode accepts one through five target colours and updates the live preview.
- Cancel leaves the previous source unchanged.
- An image with no visible subject pixels after background removal is rejected.

## Creator generation

- Full-white 50×50 succeeds.
- Thin shapes succeed.
- Disconnected components succeed.
- Isolated visible pixels succeed.
- Every valid quantised pixel occupied.
- No black pixel occupied.
- Export imports into game.
- Play-test solution completes.

# Troubleshooting

## Service worker does not work

Do not open `index.html` through `file://`. Use localhost or HTTPS.

```bash
python3 -m http.server 8000
```

## GitHub Pages serves an old build

- Increment `BUILD_VERSION`.
- Confirm the new service worker deployed.
- Use the in-game update prompt.
- If necessary, remove the installed Home Screen app and site data during development only.

## A manual level is ignored

- Confirm the file is in the `levels` directory beside the `js` directory.
- Confirm the filename uses `level_NNN.json`, with at least three digits.
- Confirm the embedded `number` matches the filename number.
- Confirm the JSON validates and is no larger than 50×50.
- Confirm the level is currently unlocked; hosted files are requested when their level number is opened.
- A locally imported level of the same number has higher priority for that browser. Remove that imported copy or clear the imported-level storage when testing the hosted file.
- Open the browser network inspector and confirm the request remains under the repository path, such as `/Choobs/levels/level_004.json`.

## Creator generation fails

- Confirm the processed image has at least one visible non-background pixel.
- Try another seed.
- Use shorter average pipes.
- Extremely pathological masks can force many singleton/fallback pipes; exact coverage has priority but the generator still needs legal directions and solvability.

## Image result seems inverted

Visible subject pixels become valid pipe cells. Transparent pixels and a sufficiently dominant dark border background become empty. Crop or edit the source first when a dark subject is being mistaken for background.

## Large board feels too large

Pinch inward to zoom out. Double two-finger tap restores 100%, not fit-to-screen.

## Close button does not close Safari

This is a browser security restriction. The game has already autosaved; close or navigate away manually.

# Complete named-function reference

The following sections inventory every named JavaScript function, method, getter, and setter in the documented build. Anonymous event callbacks are described through their owning `install_events`, service-worker event, or subsystem sections rather than being assigned invented names.

## Game application function reference

Source: `game/js/game.js`. Line numbers refer to the documented build.

### `GameApplication.constructor(elements)`

**Location:** line 5. **Kind:** method.


Initializes a new instance, creates its owned state, normalizes required dependencies, and establishes the invariants that every later method assumes.

### `GameApplication.install_events()`

**Location:** line 78. **Kind:** method.


Registers all DOM, pointer, keyboard, lifecycle, drag-and-drop, and button listeners owned by the application. It is the central wiring function and does not itself perform gameplay; it routes events to the appropriate methods.

### `GameApplication.setup_back_button_intercept()`

**Location:** line 250. **Kind:** method.


Installs a History API guard so a browser or device back action opens or closes the pause menu instead of immediately navigating away. It degrades safely when history manipulation is unavailable.

### `GameApplication.get_current_history_url()`

**Location:** line 281. **Kind:** method.


Builds the current URL and writes the active level number into its query string. The result is used when arming or refreshing the back-button history guard.

### `GameApplication.rearm_history_guard()`

**Location:** line 294. **Kind:** method.


Pushes the synthetic pause-menu history state again after a popstate event, unless the app is intentionally allowing navigation away.

### `GameApplication.open_pause_menu()`

**Location:** line 311. **Kind:** method.


Autosaves immediately, freezes gameplay timers, clears transient pointer state, updates menu labels, shows the modal sheet, and moves keyboard focus to Resume.

### `GameApplication.close_pause_menu()`

**Location:** line 331. **Kind:** method.


Hides the pause sheet, shifts all time-based effects and deadlines by the paused duration, resumes the animation clock, saves again, and returns focus to the game canvas.

### `GameApplication.shift_timers_for_pause(duration)`

**Location:** line 352. **Kind:** method.


Moves absolute performance-clock deadlines forward so combo timers, hints, penalties, effects, introductions, and completion animations do not expire while paused.

### `GameApplication.update_pause_menu()`

**Location:** line 384. **Kind:** method.


Synchronizes the pause sheet with the current level, score, selected mode, mode description, and restart availability.

### `GameApplication.show_reset_confirmation()`

**Location:** line 410. **Kind:** method.


Reveals the destructive reset confirmation and focuses its safe Cancel action.

### `GameApplication.hide_reset_confirmation()`

**Location:** line 417. **Kind:** method.


Closes the reset confirmation without changing game state.

### `GameApplication.change_game_mode(mode)`

**Location:** line 421. **Kind:** method.


Changes the active rule set between Freeplay, Heartbeat, and Permadeath while retaining the current board, then clears accumulated invalid attempts and persists the choice.

### `async GameApplication.reset_game()`

**Location:** line 435. **Kind:** async method.


Erases progression, current autosave, generated-level cache, score, and selected mode; keeps imported levels; reloads Level 1 and returns to the first-run mode chooser.

### `GameApplication.close_application()`

**Location:** line 472. **Kind:** method.


Flushes autosave, presents a saved-progress confirmation, attempts window.close(), and falls back to browser history navigation when script-initiated closing is blocked.

### `GameApplication.return_from_close_screen()`

**Location:** line 499. **Kind:** method.


Cancels the close flow, restores the history guard, resumes the frame clock, and returns focus to gameplay.

### `GameApplication.register_interaction()`

**Location:** line 512. **Kind:** method.


Records recent user activity, postpones the automatic hint, and clears any currently displayed hint.

### `GameApplication.format_score(value)`

**Location:** line 520. **Kind:** method.


Converts a nonnegative numeric score into an en-US integer string with grouping separators.

### `GameApplication.load_score_state()`

**Location:** line 526. **Kind:** method.


Reads and validates version 1 run-score state from localStorage, returning safe zeroed defaults when missing or malformed.

### `GameApplication.save_score_state()`

**Location:** line 555. **Kind:** method.


Persists run score, level-attempt rollback point, current score level, and best combo in a versioned localStorage record.

### `GameApplication.reset_run_score()`

**Location:** line 572. **Kind:** method.


Resets every run-scoring field, removes the persisted score record, clears combo state, and refreshes score UI.

### `GameApplication.reset_combo(announce = false)`

**Location:** line 589. **Kind:** method.


Stops the current combo and timer. It can optionally announce that an existing multiplier ended.

### `GameApplication.get_combo_window(combo)`

**Location:** line 601. **Kind:** method.


Returns the allowed delay before the next valid activation. The window starts at 2400 ms, tightens by 80 ms per additional combo step, and never falls below 760 ms.

### `GameApplication.award_pipe_points(pipe, time, client_x, client_y)`

**Location:** line 605. **Kind:** method.


Increments or starts the combo, calculates base points from pipe cell count, multiplies by the combo, adds the result to the run score, displays feedback, and persists the score.

### `GameApplication.update_score_ui(time = performance.now())`

**Location:** line 638. **Kind:** method.


Refreshes the visible score, triggers the score-chip bump animation, updates combo presentation, and mirrors the total into the pause menu.

### `GameApplication.update_combo_ui(time = performance.now())`

**Location:** line 651. **Kind:** method.


Shows or hides the combo HUD, writes the multiplier, and scales the countdown bar according to remaining combo time.

### `GameApplication.update_combo_timer(time)`

**Location:** line 667. **Kind:** method.


Expires a combo when its deadline is reached or refreshes its countdown display while active.

### `GameApplication.show_score_burst(points, combo, client_x, client_y)`

**Location:** line 682. **Kind:** method.


Creates a short-lived DOM popup at the tap location showing awarded points and, when applicable, the multiplier.

### `GameApplication.load_game_mode()`

**Location:** line 707. **Kind:** method.


Loads a previously selected valid mode from localStorage or returns null to trigger first-run selection.

### `GameApplication.save_game_mode()`

**Location:** line 721. **Kind:** method.


Stores the active mode in localStorage.

### `GameApplication.select_game_mode(mode)`

**Location:** line 729. **Kind:** method.


Handles first-run selection: saves the mode, clears strike state, hides the chooser, saves progress, and focuses the board.

### `GameApplication.get_mode_name()`

**Location:** line 750. **Kind:** method.


Returns the human-readable name of the selected game mode.

### `GameApplication.show_mode_overlay()`

**Location:** line 762. **Kind:** method.


Opens the first-run mode chooser and focuses its first option.

### `GameApplication.hide_mode_overlay()`

**Location:** line 773. **Kind:** method.


Closes the first-run mode chooser.

### `GameApplication.reset_invalid_attempts()`

**Location:** line 777. **Kind:** method.


Clears the three-strike counter, pending penalty, and failure visual state.

### `GameApplication.update_mode_ui()`

**Location:** line 785. **Kind:** method.


Shows or hides the heart meter and marks lost hearts according to the active mode and invalid-attempt count.

### `GameApplication.register_invalid_activation(time)`

**Location:** line 812. **Kind:** method.


Counts blocked/collision taps in Heartbeat or Permadeath, updates hearts and haptics, and schedules the appropriate failure after the third strike. Freeplay only reports the blockage.

### `GameApplication.apply_failure_penalty()`

**Location:** line 843. **Kind:** method.


Executes a scheduled Heartbeat level reset or Permadeath run wipe after the failure animation delay.

### `GameApplication.has_json_files(data_transfer)`

**Location:** line 875. **Kind:** method.


Checks drag-and-drop data for at least one .json file.

### `async GameApplication.load_levels(preferred_number = null, reload_imported = true)`

**Location:** line 885. **Kind:** async method.


Merges bundled tutorial levels and locally imported levels, determines the requested/resume frontier, populates the selector, and loads the appropriate level.

### `GameApplication.get_resume_level_number()`

**Location:** line 951. **Kind:** method.


Returns the first positive level number that is not present in the completed-level set.

### `GameApplication.is_level_number_unlocked(level_number)`

**Location:** line 961. **Kind:** method.


Enforces sequential progression by allowing only levels at or below the current resume frontier.

### `GameApplication.create_level_entry(level_number)`

**Location:** line 966. **Kind:** method.


Returns a manual level, cached procedural level, or lightweight procedural placeholder for a level number.

### `GameApplication.rebuild_level_entries(frontier)`

**Location:** line 986. **Kind:** method.


Reconstructs the ordered level-entry array from Level 1 through a requested frontier.

### `GameApplication.ensure_level_entry(level_number)`

**Location:** line 995. **Kind:** method.


Extends the level-entry array to include a requested number and replaces its placeholder with any available manual or generated level.

### `async GameApplication.try_load_manual_level_file(level_number)`

**Location:** line 1019. **Kind:** async method.


Builds a `level_NNN.json` URL relative to the deployed `js/game.js` location, fetches it once per library load, validates the embedded number, and returns null when no hosted file exists.

### `async GameApplication.resolve_level(index)`

**Location:** line 1069. **Kind:** async method.


Applies the precedence chain local imported level → relative hosted folder JSON → embedded manual fallback → cached procedural level → freshly generated deterministic level.

### `GameApplication.load_imported_levels()`

**Location:** line 1105. **Kind:** method.


Reads user-imported serialized levels from localStorage, normalizes valid entries, and skips invalid entries.

### `GameApplication.save_imported_levels()`

**Location:** line 1132. **Kind:** method.


Persists the current imported-level collection.

### `async GameApplication.import_level_files(event)`

**Location:** line 1143. **Kind:** async method.


Reads one or more JSON files, validates and serializes them, replaces duplicates by level number, saves the collection, and opens the latest accepted level.

### `GameApplication.is_level_unlocked(index)`

**Location:** line 1185. **Kind:** method.


Index-based wrapper around sequential level-number unlocking.

### `GameApplication.get_resume_level_index()`

**Location:** line 1191. **Kind:** method.


Ensures and returns the array index for the next unfinished level.

### `GameApplication.get_level_option_label(level)`

**Location:** line 1196. **Kind:** method.


Formats manual levels with number and name while procedural levels remain plain numbered levels.

### `GameApplication.populate_level_select()`

**Location:** line 1205. **Kind:** method.


Rebuilds the level dropdown, adding completion marks and locked labels while disabling unavailable options.

### `async GameApplication.load_level_number(level_number)`

**Location:** line 1235. **Kind:** async method.


Validates unlock status and delegates loading by array index.

### `async GameApplication.load_level_by_index(index)`

**Location:** line 1257. **Kind:** async method.


Resolves the requested level, creates a PuzzleSession, restores compatible autosave state, restores score/zoom/pan, resets transient effects, updates URL/UI, and saves the newly loaded state.

### `async GameApplication.load_next_level()`

**Location:** line 1410. **Kind:** async method.


Ensures the next numerical level exists, updates the selector, and loads it.

### `GameApplication.restart_level(status_message = "Level restarted.")`

**Location:** line 1421. **Kind:** method.


Restores the current puzzle to its initial state and rolls run score back to the score at the start of the current level attempt.

### `GameApplication.handle_board_pointer_start(event)`

**Location:** line 1451. **Kind:** method.


Starts mouse click tracking, one-finger pan tracking, or a two-finger pinch gesture depending on pointer type and active pointer count.

### `GameApplication.handle_board_pointer_move(event)`

**Location:** line 1496. **Kind:** method.


Updates mouse hover/click tracking, one-finger panning, or combined two-finger translation and scaling.

### `GameApplication.handle_board_pointer_end(event, cancelled)`

**Location:** line 1552. **Kind:** method.


Finalizes touch gestures, recognizes double two-finger taps, transitions from pinch to one-finger pan when needed, saves view state, and converts an unmoved touch into a pipe tap.

### `GameApplication.begin_pinch_gesture()`

**Location:** line 1627. **Kind:** method.


Captures the starting two-finger distance, midpoint, scale, and logical anchor point used by the combined pan/zoom calculation.

### `GameApplication.update_pinch_gesture()`

**Location:** line 1664. **Kind:** method.


Computes distance ratio and midpoint translation for the active two-finger gesture and updates zoom around the anchored board point.

### `GameApplication.register_two_finger_tap(client_x, client_y)`

**Location:** line 1699. **Kind:** method.


Recognizes two two-finger taps within time and distance tolerances and invokes zoom reset.

### `GameApplication.reset_board_zoom()`

**Location:** line 1719. **Kind:** method.


Returns display scale to 100%, recenters the board, saves view state, reports status, and emits light haptic feedback.

### `GameApplication.set_zoom_around_point(scale, client_x, client_y, anchor_x = null, anchor_y = null)`

**Location:** line 1734. **Kind:** method.


Changes display scale while compensating scroll offsets so a selected logical board coordinate stays under the supplied client-space point.

### `GameApplication.get_pointer_distance(first, second)`

**Location:** line 1776. **Kind:** method.


Returns Euclidean distance between two tracked pointers.

### `GameApplication.get_pointer_midpoint(first, second)`

**Location:** line 1783. **Kind:** method.


Returns the client-space midpoint of two tracked pointers.

### `GameApplication.begin_pointer_gesture(event)`

**Location:** line 1790. **Kind:** method.


Records a mouse pointer-down position for click-versus-drag discrimination.

### `GameApplication.track_pointer_gesture(event)`

**Location:** line 1803. **Kind:** method.


Marks a mouse gesture as moved after it crosses the movement threshold.

### `GameApplication.finish_pointer_gesture(event)`

**Location:** line 1820. **Kind:** method.


Turns an unmoved mouse press into a gameplay tap and ignores drags.

### `GameApplication.center_board_view()`

**Location:** line 1835. **Kind:** method.


Scrolls the board viewport to the center of its content after load, resize, or zoom reset.

### `GameApplication.handle_pointer_move(event)`

**Location:** line 1854. **Kind:** method.


Maps mouse position to a grid cell, determines the hovered pipe and whether it is currently clear, and updates cursor/render state.

### `GameApplication.handle_pointer_down(event)`

**Location:** line 1875. **Kind:** method.


Processes a pipe tap: rejects unavailable interactions, activates valid pipes, awards points, or shows blocker feedback and applies mode penalties for invalid moves.

### `GameApplication.record_activation(pipe, selected_cell, time)`

**Location:** line 1957. **Kind:** method.


Stores exit metadata for a moving pipe and creates launch/ripple effects used during and after its motion.

### `GameApplication.add_effect(effect)`

**Location:** line 2001. **Kind:** method.


Adds a visual effect with a unique deterministic seed, respecting reduced-motion settings and bounding the effect list.

### `GameApplication.prune_effects(time)`

**Location:** line 2016. **Kind:** method.


Removes expired effects and requests a redraw when the list changes.

### `GameApplication.spawn_completed_pipe_effects(pipe_ids, time)`

**Location:** line 2027. **Kind:** method.


Creates exit burst effects for pipes that have fully left the board.

### `GameApplication.update_automatic_hint(time)`

**Location:** line 2048. **Kind:** method.


After inactivity, finds a removable pipe and highlights it for a limited interval, while avoiding hints during active interactions or motion.

### `GameApplication.frame(time)`

**Location:** line 2083. **Kind:** method.


Main requestAnimationFrame loop: advances simulation, penalties, combo, hints, effects, completion timing, and conditional rendering.

### `GameApplication.begin_level_completion(time)`

**Location:** line 2181. **Kind:** method.


Marks completion, awards progression, computes level points, saves score/progress, creates celebration effects, and schedules the result sheet.

### `GameApplication.show_win_overlay()`

**Location:** line 2221. **Kind:** method.


Populates run score, level points, best combo, and next-level copy, then reveals and focuses the completion dialog.

### `GameApplication.hide_win_overlay()`

**Location:** line 2233. **Kind:** method.


Closes the result sheet.

### `GameApplication.vibrate(pattern)`

**Location:** line 2238. **Kind:** method.


Calls the browser Vibration API when supported.

### `GameApplication.load_autosave()`

**Location:** line 2247. **Kind:** method.


Reads and minimally validates the version 1 autosave record.

### `GameApplication.clear_autosave()`

**Location:** line 2268. **Kind:** method.


Removes the current-board autosave.

### `GameApplication.create_session_snapshot()`

**Location:** line 2276. **Kind:** method.


Serializes mutable runtime pipe positions, active flags, moving progress, and move counters without changing the immutable level definition.

### `GameApplication.restore_session_snapshot(autosave)`

**Location:** line 2301. **Kind:** method.


Strictly validates a snapshot against the loaded level, rejects overlaps or incompatible geometry, and restores a non-complete session.

### `GameApplication.save_current_progress(reason = "autosave")`

**Location:** line 2399. **Kind:** method.


Writes the complete current-run autosave, including mode, strikes, score, zoom, pan, pending penalty, and exact session state. Completed sessions clear the transient autosave.

### `GameApplication.load_completed_numbers()`

**Location:** line 2439. **Kind:** method.


Loads the completed-level number set from localStorage.

### `GameApplication.save_completed_numbers()`

**Location:** line 2455. **Kind:** method.


Persists the completed-level set.

### `GameApplication.set_status(message)`

**Location:** line 2466. **Kind:** method.


Writes an accessibility-friendly live status message.

## Game engine function reference

Source: `game/js/engine.js`. Line numbers refer to the documented build.

### `SeededRandom.constructor(seed)`

**Location:** line 26. **Kind:** method.


Initializes a new instance, creates its owned state, normalizes required dependencies, and establishes the invariants that every later method assumes.

### `SeededRandom.next()`

**Location:** line 30. **Kind:** method.


Implements the `next` operation in `game/js/engine.js`. The signature documents its direct inputs; the surrounding subsystem section describes its state effects and invariants.

### `SeededRandom.integer(minimum, maximum_exclusive)`

**Location:** line 38. **Kind:** method.


Implements the `integer` operation in `game/js/engine.js`. The signature documents its direct inputs; the surrounding subsystem section describes its state effects and invariants.

### `SeededRandom.choice(items)`

**Location:** line 42. **Kind:** method.


Implements the `choice` operation in `game/js/engine.js`. The signature documents its direct inputs; the surrounding subsystem section describes its state effects and invariants.

### `SeededRandom.shuffle(items)`

**Location:** line 46. **Kind:** method.


Implements the `shuffle` operation in `game/js/engine.js`. The signature documents its direct inputs; the surrounding subsystem section describes its state effects and invariants.

### `Grid.constructor(columns, rows, valid_cells)`

**Location:** line 57. **Kind:** method.


Initializes a new instance, creates its owned state, normalizes required dependencies, and establishes the invariants that every later method assumes.

### `Grid.index(x, y)`

**Location:** line 66. **Kind:** method.


Implements the `index` operation in `game/js/engine.js`. The signature documents its direct inputs; the surrounding subsystem section describes its state effects and invariants.

### `Grid.coordinates(index)`

**Location:** line 70. **Kind:** method.


Implements the `coordinates` operation in `game/js/engine.js`. The signature documents its direct inputs; the surrounding subsystem section describes its state effects and invariants.

### `Grid.is_inside(x, y)`

**Location:** line 77. **Kind:** method.


Tests whether a coordinate lies within a procedural profile's target grid.

### `Grid.get_occupant(x, y)`

**Location:** line 81. **Kind:** method.


Returns occupant. This is an internal method in `game/js/engine.js`; its inputs are given by the signature and it participates in the surrounding subsystem described above.

### `Grid.set_occupant(x, y, pipe_id)`

**Location:** line 85. **Kind:** method.


Sets occupant. This is an internal method in `game/js/engine.js`; its inputs are given by the signature and it participates in the surrounding subsystem described above.

### `create_seed()`

**Location:** line 91. **Kind:** function.


Creates an unsigned 32-bit seed using crypto.getRandomValues when possible and a time/random fallback otherwise.

### `clean_mask(mask, columns, rows, minimum_component_size = 3)`

**Location:** line 104. **Kind:** function.


Normalizes a mask to binary values and removes connected components smaller than the requested threshold.

### `resize_mask(mask, old_columns, old_rows, new_columns, new_rows)`

**Location:** line 154. **Kind:** function.


Resamples a binary mask to different grid dimensions using nearest-cell lookup.

### `count_available_neighbors(grid, available, index)`

**Location:** line 177. **Kind:** function.


Counts orthogonally adjacent cells that are still available to the generator.

### `count_occupied_neighbors(grid, x, y)`

**Location:** line 197. **Kind:** function.


Counts orthogonally adjacent cells already occupied by generated pipes.

### `count_nearby_occupied_cells(grid, x, y)`

**Location:** line 215. **Kind:** function.


Counts occupied cells in a wider local neighborhood for contour-following and nesting scores.

### `count_path_neighbors(grid, path_marks, path_token, x, y, current_index)`

**Location:** line 241. **Kind:** function.


Counts neighbors belonging to the path currently being constructed, excluding the immediately previous segment where appropriate.

### `weighted_choice(items, random)`

**Location:** line 272. **Kind:** function.


Selects an item according to nonnegative weights using the deterministic random source.

### `remove_remaining_index(index, available, remaining_indices, remaining_positions)`

**Location:** line 292. **Kind:** function.


Removes a cell from the generator's O(1)-addressable remaining-cell arrays and updates swapped-position bookkeeping.

### `choose_start_index(grid, available, remaining_indices, random, nesting)`

**Location:** line 316. **Kind:** function.


Scores and selects a new unoccupied starting cell, preferring positions that support the requested nesting behavior.

### `grow_path(grid, available, start_index, target_length, random, nesting, path_marks, path_token)`

**Location:** line 374. **Kind:** function.


Grows a path cell by cell using local availability, turning, contact, boundary, orphan, and straight-limit constraints.

### `evaluate_path_orientation(grid, available, path_indices, orientation)`

**Location:** line 501. **Kind:** function.


Evaluates whether one end of a path can serve as the arrow head and how clear or blocked its exit ray would be.

### `count_path_contact(grid, path_indices)`

**Location:** line 554. **Kind:** function.


Measures how much a path touches existing structure, used as a nesting signal.

### `direction_index_from_vector(direction)`

**Location:** line 584. **Kind:** function.


Maps an orthogonal direction vector to the engine's four-direction index.

### `build_frontier_candidates(grid, available, remaining_indices)`

**Location:** line 597. **Kind:** function.


Finds possible boundary cells from which the next pipe can be grown around already occupied structure.

### `add_candidate(x, y, direction_index)`

**Location:** line 619. **Kind:** function.


Nested helper that deduplicates and records a frontier candidate with an approach direction.

### `count_side_contacts(grid, x, y, direction_index)`

**Location:** line 693. **Kind:** function.


Counts occupied cells alongside a prospective direction, rewarding routes that run around existing pipes.

### `count_remaining_neighbors_after_path(grid, available, path_marks, path_token, index)`

**Location:** line 716. **Kind:** function.


Predicts remaining connectivity around a cell after the proposed path is removed from availability.

### `collect_orphaned_cells_after_path(grid, available, path_indices, path_marks, path_token)`

**Location:** line 748. **Kind:** function.


Finds cells that would become isolated if the proposed path were committed.

### `count_structural_boundary_contacts(grid, available, path_marks, path_token, x, y, direction_index)`

**Location:** line 799. **Kind:** function.


Counts contacts where a new step follows mask edges or pipe boundaries in a structurally meaningful way.

### `calculate_entanglement_score(grid, available, path_marks, path_token, next_x, next_y, direction_index, previous_direction_index, nesting)`

**Location:** line 839. **Kind:** function.


Scores a candidate next step using turns, side contacts, wrapping, boundaries, continuation, local density, straight-run pressure, and nesting strength.

### `grow_frontier_path(grid, available, frontier, target_length, random, nesting, path_marks, path_token)`

**Location:** line 907. **Kind:** function.


Builds a pipe outward from an occupied/unoccupied frontier so it follows and wraps around the existing structure.

### `score_frontier_candidate(grid, frontier, random, nesting, remaining_count)`

**Location:** line 1069. **Kind:** function.


Ranks frontier starts according to connectivity, nesting opportunities, remaining area, and deterministic variation.

### `head_extension_is_safe(grid, target, new_head, new_direction)`

**Location:** line 1107. **Kind:** function.


Checks whether extending a pipe head in a given direction preserves orthogonality and avoids immediately invalid geometry.

### `merge_singleton_pipes(grid, pipes)`

**Location:** line 1140. **Kind:** function.


Iteratively eliminates singleton pipes where possible by merging or restructuring adjacent pipe geometry.

### `carve_pipes(grid, random, length_setting, nesting_setting)`

**Location:** line 1303. **Kind:** function.


Partitions all valid mask cells into non-overlapping pipe paths, assigns directions and a solution order, and returns aggregate style metrics. In creator exact-cover mode it must cover every valid cell even when small fallback pipes are required.

### `calculate_orientation_data(grid, pipe, orientation)`

**Location:** line 1500. **Kind:** function.


Analyzes blockers, exit distance, contact geometry, and scoring information for one of a pipe's two possible endpoint orientations.

### `assign_solvable_orientations(grid, pipes, random, nesting_setting = 0)`

**Location:** line 1572. **Kind:** function.


Searches endpoint-direction assignments that produce a complete valid removal order and favor nested dependency structure.

### `calculate_difficulty(level)`

**Location:** line 1727. **Kind:** function.


Builds the static blocker graph and reports pipe count, segment count, initially open pipes, maximum dependency depth, and average pipe length.

### `depth(pipe_id, visiting)`

**Location:** line 1760. **Kind:** function.


Recursive memoized helper used by calculate_difficulty to measure dependency-chain depth while avoiding cycles.

### `generate_level(options)`

**Location:** line 1804. **Kind:** function.


Top-level mask-to-level generator. It validates dimensions, prepares the mask, retries deterministic seeds, carves full pipe coverage, enforces style/solvability rules, and returns canonical level data with difficulty metadata.

### `normalize_level(raw_level)`

**Location:** line 1933. **Kind:** function.


Converts raw JSON-like level data into canonical numeric objects, validates it, and calculates difficulty when absent.

### `analyze_pipe_style(cells)`

**Location:** line 2010. **Kind:** function.


Game-engine validator helper that measures maximum straight cells, turns, and segment count for one pipe.

### `validate_level(level)`

**Location:** line 2050. **Kind:** function.


Enforces the complete level contract: dimensions, mask length, unique IDs, orthogonal contiguous cells, no overlap, mask coverage rules, legal direction vectors, straight-run limits, and a valid complete solution order.

### `serialize_level(level)`

**Location:** line 2217. **Kind:** function.


Normalizes a level and converts object cells/directions back into compact array-based JSON-safe data.

### `PuzzleSession.constructor(raw_level)`

**Location:** line 2243. **Kind:** method.


Initializes a new instance, creates its owned state, normalizes required dependencies, and establishes the invariants that every later method assumes.

### `PuzzleSession.reset()`

**Location:** line 2260. **Kind:** method.


Restores a PuzzleSession to a fresh mutable copy of its immutable source level.

### `PuzzleSession.rebuild_occupancy()`

**Location:** line 2280. **Kind:** method.


Reconstructs the grid's pipe-ID occupancy array from active in-bounds pipe cells.

### `PuzzleSession.mark_state_changed()`

**Location:** line 2294. **Kind:** method.


Increments the session state version and clears collision caches that depend on geometry.

### `PuzzleSession.get_pipe(pipe_id)`

**Location:** line 2299. **Kind:** method.


Returns a mutable runtime pipe by ID.

### `PuzzleSession.get_active_count()`

**Location:** line 2303. **Kind:** method.


Counts pipes still active on or moving through the board.

### `PuzzleSession.get_moving_count()`

**Location:** line 2307. **Kind:** method.


Returns the number of pipes currently moving.

### `PuzzleSession.is_complete()`

**Location:** line 2311. **Kind:** method.


Returns true when no active pipes remain.

### `PuzzleSession.can_activate(pipe_id)`

**Location:** line 2315. **Kind:** method.


Determines whether a pipe may begin moving, distinguishing nonexistent, inactive, already-moving, stationary-blocked, moving-collision, and valid cases.

### `PuzzleSession.get_stationary_blocker(pipe)`

**Location:** line 2349. **Kind:** method.


Scans the arrow ray for the first nonmoving active pipe occupying the path.

### `PuzzleSession.get_moving_collision(candidate_pipe)`

**Location:** line 2372. **Kind:** method.


Checks the candidate against every currently moving pipe using swept-cell rejection and detailed temporal geometry simulation.

### `PuzzleSession.get_cached_swept_cell_set(pipe)`

**Location:** line 2409. **Kind:** method.


Returns a state-version-keyed set of all grid cells a pipe can sweep through on its way off the board.

### `PuzzleSession.create_swept_cell_set(pipe)`

**Location:** line 2421. **Kind:** method.


Builds the conservative swept-cell set for a pipe's complete future motion.

### `PuzzleSession.cell_sets_overlap(left, right)`

**Location:** line 2442. **Kind:** method.


Quickly tests whether two swept-cell sets share any cell.

### `PuzzleSession.simulate_pair_collision(candidate_pipe, moving_pipe, moving_progress)`

**Location:** line 2455. **Kind:** method.


Advances two pipes through normalized time to detect crossing, overlap, contact, or position swapping during concurrent movement.

### `PuzzleSession.create_simulation_state(pipe, progress)`

**Location:** line 2508. **Kind:** method.


Creates a lightweight simulated pipe position at a fractional movement progress.

### `PuzzleSession.advance_simulation_state(state, delta)`

**Location:** line 2523. **Kind:** method.


Advances a simulated pipe state by a normalized amount, including whole-cell steps.

### `PuzzleSession.simulation_states_collide(left_state, right_state)`

**Location:** line 2546. **Kind:** method.


Tests two simulation states for duplicate cells, segment intersections, or insufficient polyline separation.

### `PuzzleSession.get_simulation_render_cells(state)`

**Location:** line 2559. **Kind:** method.


Converts a simulation state into interpolated polyline points.

### `PuzzleSession.polylines_collide(left_points, right_points, minimum_distance)`

**Location:** line 2583. **Kind:** method.


Tests all segment pairs between two polylines using bounds rejection and exact distance/intersection checks.

### `PuzzleSession.segment_bounds_overlap(left_start, left_end, right_start, right_end, padding)`

**Location:** line 2629. **Kind:** method.


Fast axis-aligned bounding-box overlap test for two segments with optional padding.

### `PuzzleSession.segment_distance_squared(left_start, left_end, right_start, right_end)`

**Location:** line 2661. **Kind:** method.


Returns the squared minimum distance between two line segments, including intersection cases.

### `PuzzleSession.segments_intersect(left_start, left_end, right_start, right_end)`

**Location:** line 2700. **Kind:** method.


Robustly determines whether two finite segments intersect or touch.

### `PuzzleSession.cross_product(start, end, point)`

**Location:** line 2784. **Kind:** method.


Returns the signed 2D cross product used for orientation tests.

### `PuzzleSession.point_on_segment(point, start, end, epsilon)`

**Location:** line 2791. **Kind:** method.


Checks whether a collinear point lies within a segment's bounds.

### `PuzzleSession.point_segment_distance_squared(point, start, end)`

**Location:** line 2800. **Kind:** method.


Returns squared distance from a point to the nearest point on a segment.

### `PuzzleSession.activate(pipe_id)`

**Location:** line 2836. **Kind:** method.


Calls can_activate and, on success, places the pipe in the moving map at zero progress and increments move count.

### `PuzzleSession.get_removable_pipe_ids()`

**Location:** line 2849. **Kind:** method.


Returns IDs of all pipes that can legally be activated in the current concurrent state.

### `PuzzleSession.update(delta_milliseconds)`

**Location:** line 2861. **Kind:** method.


Advances every moving pipe according to elapsed milliseconds, performs whole-cell steps, rebuilds occupancy, and reports completed pipe IDs.

### `PuzzleSession.advance_pipe_step(pipe_id)`

**Location:** line 2893. **Kind:** method.


Moves one pipe forward by one grid step, then deactivates it once every segment lies outside the grid.

### `PuzzleSession.get_render_cells(pipe_id)`

**Location:** line 2923. **Kind:** method.


Returns interpolated cell coordinates for drawing a stationary or moving pipe.

### `ease_in_out(value)`

**Location:** line 2956. **Kind:** function.


Quadratic ease-in/ease-out interpolation used to smooth per-cell movement.

## Procedural generator function reference

Source: `game/js/procedural_levels.js`. Line numbers refer to the documented build.

### `clamp(value, minimum, maximum)`

**Location:** line 7. **Kind:** function.


Clamps a numeric value between inclusive bounds.

### `mix_uint32(value)`

**Location:** line 11. **Kind:** function.


Avalanches a 32-bit integer into a deterministic pseudo-random 32-bit value for stable level-number seeding.

### `next_power_of_two(value)`

**Location:** line 21. **Kind:** function.


Returns the smallest power of two greater than or equal to the input.

### `round_to_even(value)`

**Location:** line 31. **Kind:** function.


Rounds a procedural board size to an even integer and clamps it to 10–50.

### `choose_even_size(minimum, maximum, random_value)`

**Location:** line 35. **Kind:** function.


Selects an even grid size from an inclusive range using a normalized deterministic random value.

### `create_level_profile(level_number)`

**Location:** line 47. **Kind:** function.


Derives board size, growth phase, Hilbert source size, seed, target pipe length, and complexity bounds from the level number. Levels 1–50 grow; Level 50 is 50×50; later levels sample 10–50 freely.

### `create_layout_profile(profile)`

**Location:** line 109. **Kind:** function.


Creates the square power-of-two profile used by the nested source-curve layout before cropping to the target board.

### `rotate_hilbert_quadrant(size, x, y, rotate_x, rotate_y)`

**Location:** line 117. **Kind:** function.


Applies the Hilbert-curve quadrant rotation/reflection transform.

### `hilbert_index_to_cell(size, distance)`

**Location:** line 135. **Kind:** function.


Converts a Hilbert distance index into a 2D grid coordinate.

### `transform_cell(cell, size, transform)`

**Location:** line 159. **Kind:** function.


Applies one of the supported rotations/reflections to a source-curve cell.

### `build_nested_curve(profile, transform, reverse_curve)`

**Location:** line 178. **Kind:** function.


Constructs and optionally reverses/transforms the Hilbert-style space-filling curve used as the base tangled route.

### `direction_between(from, to)`

**Location:** line 197. **Kind:** function.


Returns the unit orthogonal direction from one adjacent cell to another.

### `directions_match(left, right)`

**Location:** line 204. **Kind:** function.


Tests exact direction equality.

### `directions_are_perpendicular(left, right)`

**Location:** line 210. **Kind:** function.


Tests whether two orthogonal vectors have zero dot product.

### `directions_are_opposites(left, right)`

**Location:** line 215. **Kind:** function.


Tests whether two direction vectors point exactly opposite ways.

### `build_curve_metadata(profile, curve)`

**Location:** line 221. **Kind:** function.


Precomputes directions, turns, local contacts, and other per-index curve metrics used during partition search.

### `is_inside(profile, x, y)`

**Location:** line 291. **Kind:** function.


Tests whether a coordinate lies within a procedural profile's target grid.

### `analyze_aim_endpoint(profile, curve, metadata, end_index)`

**Location:** line 295. **Kind:** function.


Analyzes an endpoint's forward ray to find its first target, perpendicularity, blocker count, exit distance, and suitability as an arrow.

### `build_endpoint_catalog(profile, curve, metadata)`

**Location:** line 363. **Kind:** function.


Precomputes endpoint analysis for every possible curve split position and orientation.

### `interval_turn_count(metadata, start, end)`

**Location:** line 393. **Kind:** function.


Returns the number of turns inside a curve interval using prefix metadata.

### `interval_wrap_contacts(metadata, start, end)`

**Location:** line 401. **Kind:** function.


Returns the wrap/contact score inside a curve interval.

### `partition_curve(profile, curve, metadata, endpoints, target_length, tie_seed)`

**Location:** line 405. **Kind:** function.


Uses dynamic programming/search to split the long source curve into pipes that meet length, turn, aim, overlap, and interlocking targets.

### `build_pipes_from_partition(profile, partition)`

**Location:** line 501. **Kind:** function.


Converts selected curve intervals into concrete pipe objects with IDs, colors, cells, and arrow directions.

### `locate_pipe_cell(pipe, x, y)`

**Location:** line 522. **Kind:** function.


Finds the index of a coordinate inside a pipe or reports that it is absent.

### `target_pipe_is_perpendicular(pipe, cell_index, direction)`

**Location:** line 534. **Kind:** function.


Checks whether the target pipe segment at a hit cell runs perpendicular to the incoming arrow ray.

### `analyze_interlocking(profile, pipes)`

**Location:** line 559. **Kind:** function.


Measures aimed pipes, perpendicular targets, shared targets, overlapping aims, and blocker depth for a pipe layout.

### `analyze_pipe(cells)`

**Location:** line 681. **Kind:** function.


Calculates turns, straight-run length, and local geometry for one procedural pipe.

### `analyze_style(pipes)`

**Location:** line 714. **Kind:** function.


Aggregates procedural pipe style metrics.

### `score_partition_candidate(profile, partition)`

**Location:** line 757. **Kind:** function.


Combines length consistency, turn density, perpendicular aims, shared targets, blocker depth, and straight-run compliance into a layout score.

### `build_best_layout(profile)`

**Location:** line 783. **Kind:** function.


Tries deterministic transforms, reversals, and target lengths; validates candidates; and keeps the highest-scoring interlocking source layout.

### `smooth_step(value)`

**Location:** line 861. **Kind:** function.


Applies cubic smoothstep interpolation to a normalized value.

### `sample_noise_grid(noise, size, normalized_x, normalized_y)`

**Location:** line 867. **Kind:** function.


Bilinearly samples a coarse deterministic noise grid.

### `keep_largest_cell_component(mask, columns, rows)`

**Location:** line 886. **Kind:** function.


Removes all but the largest orthogonally connected component of a binary mask.

### `distance_from_empty(mask, columns, rows)`

**Location:** line 946. **Kind:** function.


Computes a grid distance field measuring how far each selected cell is from empty space.

### `create_blob_field(profile)`

**Location:** line 1001. **Kind:** function.


Creates the deterministic multi-scale organic scalar field that drives lobes, dents, warped edges, and hole placement.

### `build_pipe_adjacency(profile, pipes)`

**Location:** line 1249. **Kind:** function.


Builds a graph of neighboring pipes whose cells touch orthogonally.

### `pipe_components(selected, adjacency)`

**Location:** line 1301. **Kind:** function.


Returns connected components of a selected subset of pipes in the pipe-adjacency graph.

### `analyze_mask_shape(mask, columns, rows)`

**Location:** line 1333. **Kind:** function.


Measures area, bounding box, fill ratio, perimeter, connectivity, and enclosed-hole statistics for a binary mask.

### `enqueue_empty(x, y)`

**Location:** line 1380. **Kind:** function.


Nested flood-fill helper used while analyzing exterior and enclosed empty regions.

### `build_selected_mask(profile, pipes, selected)`

**Location:** line 1501. **Kind:** function.


Builds a cell mask by retaining complete pipes from a Boolean selected-pipe set.

### `carve_enclosed_pipe_hole(profile, pipes, selected, adjacency)`

**Location:** line 1517. **Kind:** function.


Attempts to remove a connected group of whole pipes to form an enclosed hole while keeping the selected silhouette connected.

### `consider(removals)`

**Location:** line 1562. **Kind:** function.


Nested candidate-evaluation helper that scores possible pipe removals for hole carving.

### `select_blob_pipes(profile, pipes)`

**Location:** line 1622. **Kind:** function.


Selects a connected subset of complete pipes according to the organic field, repairs connectivity, targets an area ratio, and adds valid enclosed holes.

### `build_crop_offsets(profile, attempt_count = 30)`

**Location:** line 1789. **Kind:** function.


Produces deterministic crop offsets that place the source curve differently within the requested grid dimensions.

### `add(x, y)`

**Location:** line 1794. **Kind:** function.


Nested deduplication helper for crop offsets.

### `crop_whole_pipes(profile, pipes, offset)`

**Location:** line 1831. **Kind:** function.


Translates/crops the source layout while retaining only complete pipes that fit inside the target board.

### `build_blob_candidate(profile, layout, crop_offset, attempt)`

**Location:** line 1878. **Kind:** function.


Combines a crop, blob field, whole-pipe selection, shape validation, and interlocking analysis into one scored procedural candidate.

### `analyze_filtered_interlocking(profile, pipes)`

**Location:** line 1947. **Kind:** function.


Recomputes interlocking metrics after whole-pipe cropping and blob selection.

### `build_level_options(level_number)`

**Location:** line 2054. **Kind:** function.


Public alias that returns the procedural profile for a level number.

### `generate(level_number)`

**Location:** line 2058. **Kind:** function.


Public deterministic procedural generator. It builds many crop/blob variants, rejects unsuitable masks, selects the best candidate, emits canonical level data, and normalizes it through the shared engine.

## Game canvas renderer function reference

Source: `game/js/canvas_renderer.js`. Line numbers refer to the documented build.

### `CanvasRenderer.constructor(canvas)`

**Location:** line 5. **Kind:** method.


Initializes a new instance, creates its owned state, normalizes required dependencies, and establishes the invariants that every later method assumes.

### `get CanvasRenderer.show_mask()`

**Location:** line 28. **Kind:** getter.


Returns whether the valid-cell mask background is currently visible.

### `set CanvasRenderer.show_mask(value)`

**Location:** line 32. **Kind:** setter.


Changes mask visibility and invalidates the static background cache when the value changes.

### `CanvasRenderer.set_level(level)`

**Location:** line 41. **Kind:** method.


Sets level. This is an internal method in `game/js/canvas_renderer.js`; its inputs are given by the signature and it participates in the surrounding subsystem described above.

### `CanvasRenderer.get_device_scale()`

**Location:** line 47. **Kind:** method.


Returns a device-pixel ratio capped at 1.5 to control memory use.

### `CanvasRenderer.clamp_display_scale(value)`

**Location:** line 51. **Kind:** method.


Clamps zoom to the renderer's 0.02–512 display-scale range.

### `CanvasRenderer.get_display_scale()`

**Location:** line 64. **Kind:** method.


Returns the current CSS display zoom.

### `CanvasRenderer.set_display_scale(value)`

**Location:** line 68. **Kind:** method.


Clamps and applies zoom, resizing the canvas only when the value materially changes.

### `CanvasRenderer.get_render_scale(css_width, css_height)`

**Location:** line 80. **Kind:** method.


Computes backing-canvas resolution from device scale, display zoom, logical area, and the nine-million-pixel memory cap.

### `CanvasRenderer.resize()`

**Location:** line 93. **Kind:** method.


Sizes the game canvas from fixed 12-pixel cells, board dimensions, padding, zoom, and render-memory limits.

### `CanvasRenderer.pointer_to_cell(event)`

**Location:** line 125. **Kind:** method.


Converts a client pointer position through CSS scaling back into an integer grid coordinate or null.

### `CanvasRenderer.render(session, visual_state = {})`

**Location:** line 157. **Kind:** method.


Draws the cached board, pipes, guides, motion, states, and effects for one animation frame.

### `CanvasRenderer.ensure_background_cache()`

**Location:** line 221. **Kind:** method.


Rebuilds the offscreen static board cache only when level, size, or mask visibility changes.

### `CanvasRenderer.draw_board_background(context)`

**Location:** line 247. **Kind:** method.


Paints the dark board surface, valid-cell mask, subtle depth, and static grid into the cache.

### `CanvasRenderer.draw_grid(context)`

**Location:** line 283. **Kind:** method.


Draws restrained grid lines over valid cells.

### `CanvasRenderer.draw_exit_guide(context, session, visual_state)`

**Location:** line 325. **Kind:** method.


Draws the directional continuation guide for a hovered, hinted, or moving pipe.

### `CanvasRenderer.draw_pipe(context, session, pipe, visual_state, time)`

**Location:** line 387. **Kind:** method.


Draws one pipe's outline, inner stroke, moving interpolation, state emphasis, arrow, streaks, and endpoint treatment.

### `CanvasRenderer.get_intro_alpha(pipe_id, time, intro_started)`

**Location:** line 525. **Kind:** method.


Returns staggered introduction opacity for a pipe after level load.

### `CanvasRenderer.draw_speed_streaks(context, points, direction, color, cell_size, time, pipe_id)`

**Location:** line 539. **Kind:** method.


Draws short motion trails behind a moving pipe.

### `CanvasRenderer.draw_motion_tip(context, tip, color, cell_size, time, pipe_id)`

**Location:** line 579. **Kind:** method.


Draws a highlighted leading tip on a moving pipe.

### `CanvasRenderer.draw_effects(context, effects, time, layer)`

**Location:** line 599. **Kind:** method.


Dispatches active effects by layer and effect type.

### `CanvasRenderer.draw_ripple(context, effect, progress)`

**Location:** line 627. **Kind:** method.


Draws the activation ripple at the selected cell.

### `CanvasRenderer.draw_launch(context, effect, progress)`

**Location:** line 642. **Kind:** method.


Draws the short forward impulse at a pipe head.

### `CanvasRenderer.draw_impact(context, effect, progress)`

**Location:** line 679. **Kind:** method.


Draws blocked-tap impact feedback.

### `CanvasRenderer.draw_burst(context, effect, progress)`

**Location:** line 705. **Kind:** method.


Draws particles when a pipe clears the board.

### `CanvasRenderer.draw_celebration(context, effect, progress)`

**Location:** line 737. **Kind:** method.


Draws the level-completion celebration.

### `CanvasRenderer.noise(seed, index)`

**Location:** line 767. **Kind:** method.


Returns a deterministic pseudo-random scalar for visual particles/streaks.

### `CanvasRenderer.grid_point_to_canvas(grid_x, grid_y)`

**Location:** line 775. **Kind:** method.


Converts logical grid coordinates into canvas coordinates.

### `CanvasRenderer.cell_center(grid_x, grid_y)`

**Location:** line 782. **Kind:** method.


Returns the canvas center of a grid cell.

### `CanvasRenderer.stroke_polyline(context, points, color, width)`

**Location:** line 786. **Kind:** method.


Strokes a rounded polyline through a list of canvas points.

### `CanvasRenderer.draw_arrow(context, center, direction, outer_color, inner_color, outer_width, inner_width, cell_size)`

**Location:** line 799. **Kind:** method.


Draws the open line-tool-style arrow structure at the pipe head.

## PWA controller function reference

Source: `game/js/pwa.js`. Line numbers refer to the documented build.

### `is_standalone()`

**Location:** line 20. **Kind:** function.


Detects whether Choobs is running as an installed standalone web app.

### `is_ios()`

**Location:** line 25. **Kind:** function.


Detects iPhone, iPad, or iPod user agents, including iPadOS desktop-mode devices where applicable.

### `can_offer_install()`

**Location:** line 30. **Kind:** function.


Returns whether the Install Choobs menu item should be shown.

### `update_install_button()`

**Location:** line 34. **Kind:** function.


Synchronizes install-menu visibility with platform, standalone state, and deferred browser install capability.

### `open_install_overlay()`

**Location:** line 42. **Kind:** function.


Displays the iOS/manual installation instructions.

### `close_install_overlay()`

**Location:** line 52. **Kind:** function.


Hides installation instructions and returns focus appropriately.

### `async request_install()`

**Location:** line 62. **Kind:** async function.


Uses a captured beforeinstallprompt event when supported; otherwise opens the manual iOS installation guide.

### `show_connection_message(message)`

**Location:** line 83. **Kind:** function.


Shows a temporary online/offline status toast.

### `show_update(worker)`

**Location:** line 96. **Kind:** function.


Displays the update-ready toast and binds the waiting service worker that should be activated.

### `watch_installing_worker(registration)`

**Location:** line 105. **Kind:** function.


Observes an installing service worker and exposes it once installed behind an existing controller.

### `async register_service_worker()`

**Location:** line 119. **Kind:** async function.


Registers service-worker.js, handles waiting/installing updates, checks periodically and on visibility/online changes, and reloads after controller replacement.

## Level creator application function reference

Source: `creator/js/creator.js`. Line numbers refer to the documented build.

### `LevelEditorApplication.constructor(elements)`

**Location:** line 13. **Kind:** method.


Initializes a new instance, creates its owned state, normalizes required dependencies, and establishes the invariants that every later method assumes.

### `LevelEditorApplication.install_events()`

**Location:** line 54. **Kind:** method.


Registers all DOM, pointer, keyboard, lifecycle, drag-and-drop, and button listeners owned by the application. It is the central wiring function and does not itself perform gameplay; it routes events to the appropriate methods.

### `async LevelEditorApplication.refresh_library()`

**Location:** line 217. **Kind:** async method.


Resets the unused server-library interface to standalone export mode.

### `LevelEditorApplication.render_library()`

**Location:** line 225. **Kind:** method.


Renders optional in-memory library entries or an empty-state message.

### `LevelEditorApplication.update_library_selection()`

**Location:** line 269. **Kind:** method.


Marks the library item matching the current level-number input.

### `LevelEditorApplication.update_overwrite_notice()`

**Location:** line 288. **Kind:** method.


Updates hidden library overwrite/delete state for compatibility with the earlier server-backed interface.

### `async LevelEditorApplication.load_source_image(file)`

**Location:** line 307. **Kind:** async method.


Decodes a browser-supported image, center-crops it, nearest-neighbour scales it to 50×50, detects transparent/dominant-dark background, extracts five weighted prominent colours, and stores occupancy plus per-cell colour indices.

### `LevelEditorApplication.draw_default_source()`

**Location:** line 401. **Kind:** method.


Creates the built-in 50×50 irregular mask with two holes and assigns its valid cells across the five fallback colours.

### `LevelEditorApplication.draw_mask_to_source_canvas(mask)`

**Location:** line 436. **Kind:** method.


Writes the quantised occupancy and five-colour map into the hidden source canvas, using black only for empty cells.

### `LevelEditorApplication.draw_source_image()`

**Location:** line 451. **Kind:** method.


Repaints the current five-colour quantised source into the hidden source canvas.

### `LevelEditorApplication.create_valid_mask(columns, rows)`

**Location:** line 457. **Kind:** method.


Returns a defensive copy of the current 50×50 occupancy mask and rejects any other requested grid dimensions.

### `LevelEditorApplication.get_generation_mask(columns, rows)`

**Location:** line 469. **Kind:** method.


Creator-facing wrapper around create_valid_mask.

### `LevelEditorApplication.generate_level_off_thread(options)`

**Location:** line 473. **Kind:** method.


Runs Choobs.generate_level inside a Blob-backed Web Worker when available, relays progress messages, transfers the mask buffer, and falls back to the main thread if worker creation is unavailable.

### `async LevelEditorApplication.generate_preview()`

**Location:** line 562. **Kind:** async method.


Collects editor controls, builds exact-cover generation options, disables UI, invokes generation, starts play-test, and reports success or failure.

### `LevelEditorApplication.start_test_session()`

**Location:** line 640. **Kind:** method.


Creates a fresh PuzzleSession for the current generated/imported level and initializes renderer and transient play-test state.

### `LevelEditorApplication.reset_test()`

**Location:** line 662. **Kind:** method.


Restarts only the editor play-test session without regenerating the level.

### `LevelEditorApplication.handle_pointer_move(event)`

**Location:** line 681. **Kind:** method.


Maps mouse position to a grid cell, determines the hovered pipe and whether it is currently clear, and updates cursor/render state.

### `LevelEditorApplication.handle_pointer_down(event)`

**Location:** line 706. **Kind:** method.


Processes a pipe tap: rejects unavailable interactions, activates valid pipes, awards points, or shows blocker feedback and applies mode penalties for invalid moves.

### `LevelEditorApplication.show_hint()`

**Location:** line 763. **Kind:** method.


Highlights one currently removable pipe in the editor preview.

### `LevelEditorApplication.frame(time)`

**Location:** line 795. **Kind:** method.


Main requestAnimationFrame loop: advances simulation, penalties, combo, hints, effects, completion timing, and conditional rendering.

### `LevelEditorApplication.update_stats()`

**Location:** line 888. **Kind:** method.


Updates valid-cell, pipe, initially-open, and dependency-depth counters.

### `LevelEditorApplication.sync_level_metadata()`

**Location:** line 915. **Kind:** method.


Copies current level number/name and generation settings into the in-memory level before export.

### `LevelEditorApplication.export_level()`

**Location:** line 943. **Kind:** method.


Synchronizes metadata, serializes the current level, and triggers JSON download.

### `LevelEditorApplication.export_json_file(level)`

**Location:** line 959. **Kind:** method.


Creates a Blob and temporary object URL, then downloads a zero-padded level_NNN.json file.

### `async LevelEditorApplication.import_level_file(event)`

**Location:** line 975. **Kind:** async method.


Reads a selected JSON file, parses it, and loads it through apply_loaded_level.

### `LevelEditorApplication.load_existing_level(level_number)`

**Location:** line 1001. **Kind:** method.


Looks up a level in the creator's optional in-memory library and applies it.

### `LevelEditorApplication.apply_loaded_level(raw_level)`

**Location:** line 1017. **Kind:** method.


Normalizes imported level data, restores mask and editor controls, redraws the source, and starts play-test.

### `async LevelEditorApplication.delete_level()`

**Location:** line 1102. **Kind:** async method.


Reports that the standalone creator has no persistent internal level library.

### `LevelEditorApplication.set_controls_disabled(disabled)`

**Location:** line 1108. **Kind:** method.


Enables or disables generation/export and input controls during asynchronous generation.

### `LevelEditorApplication.set_status(message)`

**Location:** line 1127. **Kind:** method.


Writes an accessibility-friendly live status message.

## Level creator engine function reference

Source: `creator/js/engine.js`. Line numbers refer to the documented build.

### `SeededRandom.constructor(seed)`

**Location:** line 27. **Kind:** method.


Initializes a new instance, creates its owned state, normalizes required dependencies, and establishes the invariants that every later method assumes.

### `SeededRandom.next()`

**Location:** line 31. **Kind:** method.


Implements the `next` operation in `creator/js/engine.js`. The signature documents its direct inputs; the surrounding subsystem section describes its state effects and invariants.

### `SeededRandom.integer(minimum, maximum_exclusive)`

**Location:** line 39. **Kind:** method.


Implements the `integer` operation in `creator/js/engine.js`. The signature documents its direct inputs; the surrounding subsystem section describes its state effects and invariants.

### `SeededRandom.choice(items)`

**Location:** line 43. **Kind:** method.


Implements the `choice` operation in `creator/js/engine.js`. The signature documents its direct inputs; the surrounding subsystem section describes its state effects and invariants.

### `SeededRandom.shuffle(items)`

**Location:** line 47. **Kind:** method.


Implements the `shuffle` operation in `creator/js/engine.js`. The signature documents its direct inputs; the surrounding subsystem section describes its state effects and invariants.

### `Grid.constructor(columns, rows, valid_cells)`

**Location:** line 58. **Kind:** method.


Initializes a new instance, creates its owned state, normalizes required dependencies, and establishes the invariants that every later method assumes.

### `Grid.index(x, y)`

**Location:** line 67. **Kind:** method.


Implements the `index` operation in `creator/js/engine.js`. The signature documents its direct inputs; the surrounding subsystem section describes its state effects and invariants.

### `Grid.coordinates(index)`

**Location:** line 71. **Kind:** method.


Implements the `coordinates` operation in `creator/js/engine.js`. The signature documents its direct inputs; the surrounding subsystem section describes its state effects and invariants.

### `Grid.is_inside(x, y)`

**Location:** line 78. **Kind:** method.


Tests whether a coordinate lies within a procedural profile's target grid.

### `Grid.get_occupant(x, y)`

**Location:** line 82. **Kind:** method.


Returns occupant. This is an internal method in `creator/js/engine.js`; its inputs are given by the signature and it participates in the surrounding subsystem described above.

### `Grid.set_occupant(x, y, pipe_id)`

**Location:** line 86. **Kind:** method.


Sets occupant. This is an internal method in `creator/js/engine.js`; its inputs are given by the signature and it participates in the surrounding subsystem described above.

### `create_seed()`

**Location:** line 92. **Kind:** function.


Creates an unsigned 32-bit seed using crypto.getRandomValues when possible and a time/random fallback otherwise.

### `clean_mask(mask, columns, rows, minimum_component_size = 3)`

**Location:** line 105. **Kind:** function.


Normalizes a mask to binary values and removes connected components smaller than the requested threshold.

### `resize_mask(mask, old_columns, old_rows, new_columns, new_rows)`

**Location:** line 155. **Kind:** function.


Resamples a binary mask to different grid dimensions using nearest-cell lookup.

### `count_available_neighbors(grid, available, index)`

**Location:** line 178. **Kind:** function.


Counts orthogonally adjacent cells that are still available to the generator.

### `count_occupied_neighbors(grid, x, y)`

**Location:** line 198. **Kind:** function.


Counts orthogonally adjacent cells already occupied by generated pipes.

### `count_nearby_occupied_cells(grid, x, y)`

**Location:** line 216. **Kind:** function.


Counts occupied cells in a wider local neighborhood for contour-following and nesting scores.

### `count_path_neighbors(grid, path_marks, path_token, x, y, current_index)`

**Location:** line 242. **Kind:** function.


Counts neighbors belonging to the path currently being constructed, excluding the immediately previous segment where appropriate.

### `direction_between_indices(grid, first_index, second_index)`

**Location:** line 273. **Kind:** function.


Returns the orthogonal direction vector between two grid indices.

### `trailing_straight_segments_for_indices(grid, path)`

**Location:** line 285. **Kind:** function.


Counts how many consecutive path segments at the tail continue in the same direction.

### `index_path_extension_respects_straight_limit(grid, path, next_index)`

**Location:** line 317. **Kind:** function.


Checks whether appending a grid index would keep the path at or below the five-cell straight-run invariant.

### `analyze_pipe_geometry(cells)`

**Location:** line 350. **Kind:** function.


Calculates turn count, segment count, maximum straight run, and whether a pipe is straight-only.

### `cells_respect_straight_limit(cells)`

**Location:** line 398. **Kind:** function.


Returns whether a cell sequence obeys the hard maximum straight-run length.

### `analyze_pipe_collection(pipes)`

**Location:** line 405. **Kind:** function.


Aggregates geometry statistics across all pipes, including turn density, straight-only count, and singleton count.

### `weighted_choice(items, random)`

**Location:** line 434. **Kind:** function.


Selects an item according to nonnegative weights using the deterministic random source.

### `remove_remaining_index(index, available, remaining_indices, remaining_positions)`

**Location:** line 454. **Kind:** function.


Removes a cell from the generator's O(1)-addressable remaining-cell arrays and updates swapped-position bookkeeping.

### `choose_start_index(grid, available, remaining_indices, random, nesting)`

**Location:** line 478. **Kind:** function.


Scores and selects a new unoccupied starting cell, preferring positions that support the requested nesting behavior.

### `grow_path(grid, available, start_index, target_length, random, nesting, path_marks, path_token)`

**Location:** line 536. **Kind:** function.


Grows a path cell by cell using local availability, turning, contact, boundary, orphan, and straight-limit constraints.

### `evaluate_path_orientation(grid, available, path_indices, orientation)`

**Location:** line 673. **Kind:** function.


Evaluates whether one end of a path can serve as the arrow head and how clear or blocked its exit ray would be.

### `count_path_contact(grid, path_indices)`

**Location:** line 726. **Kind:** function.


Measures how much a path touches existing structure, used as a nesting signal.

### `direction_index_from_vector(direction)`

**Location:** line 756. **Kind:** function.


Maps an orthogonal direction vector to the engine's four-direction index.

### `build_frontier_candidates(grid, available, remaining_indices)`

**Location:** line 769. **Kind:** function.


Finds possible boundary cells from which the next pipe can be grown around already occupied structure.

### `add_candidate(x, y, direction_index)`

**Location:** line 791. **Kind:** function.


Nested helper that deduplicates and records a frontier candidate with an approach direction.

### `count_side_contacts(grid, x, y, direction_index)`

**Location:** line 865. **Kind:** function.


Counts occupied cells alongside a prospective direction, rewarding routes that run around existing pipes.

### `count_remaining_neighbors_after_path(grid, available, path_marks, path_token, index)`

**Location:** line 888. **Kind:** function.


Predicts remaining connectivity around a cell after the proposed path is removed from availability.

### `collect_orphaned_cells_after_path(grid, available, path_indices, path_marks, path_token)`

**Location:** line 920. **Kind:** function.


Finds cells that would become isolated if the proposed path were committed.

### `collect_orphaned_cells_for_path(grid, available, path_indices)`

**Location:** line 971. **Kind:** function.


Convenience analysis that marks a proposed path and returns the resulting isolated cells.

### `trim_path_to_avoid_orphans(grid, available, path_indices, path_marks, path_token)`

**Location:** line 1032. **Kind:** function.


Shortens a candidate path until it no longer strands avoidable cells.

### `count_structural_boundary_contacts(grid, available, path_marks, path_token, x, y, direction_index)`

**Location:** line 1070. **Kind:** function.


Counts contacts where a new step follows mask edges or pipe boundaries in a structurally meaningful way.

### `calculate_entanglement_score(grid, available, path_marks, path_token, next_x, next_y, direction_index, previous_direction_index, nesting, straight_run)`

**Location:** line 1109. **Kind:** function.


Scores a candidate next step using turns, side contacts, wrapping, boundaries, continuation, local density, straight-run pressure, and nesting strength.

### `grow_frontier_path(grid, available, frontier, target_length, random, nesting, path_marks, path_token)`

**Location:** line 1184. **Kind:** function.


Builds a pipe outward from an occupied/unoccupied frontier so it follows and wraps around the existing structure.

### `score_frontier_candidate(grid, frontier, random, nesting, remaining_count)`

**Location:** line 1362. **Kind:** function.


Ranks frontier starts according to connectivity, nesting opportunities, remaining area, and deterministic variation.

### `head_extension_is_safe(grid, target, new_head, new_direction)`

**Location:** line 1400. **Kind:** function.


Checks whether extending a pipe head in a given direction preserves orthogonality and avoids immediately invalid geometry.

### `candidate_pipe_direction_is_safe(grid, pipe_id, cells, direction)`

**Location:** line 1433. **Kind:** function.


Tests whether a complete candidate pipe and arrow direction can be introduced without violating occupancy or direction constraints.

### `try_resolve_singleton_by_prefix_transfer(grid, pipes, removed_ids, pipe)`

**Location:** line 1460. **Kind:** function.


Attempts to absorb a one-cell pipe by transferring a compatible prefix from a neighboring pipe while preserving exact coverage and legal geometry.

### `merge_singleton_pipes(grid, pipes)`

**Location:** line 1575. **Kind:** function.


Iteratively eliminates singleton pipes where possible by merging or restructuring adjacent pipe geometry.

### `merge_same_color_endpoint_singletons(grid, pipes, random, nesting_setting)`

**Location:** line 2012. **Kind:** function.


Runs after colour-boundary splitting and in the fast 50×50 exact-cover path. It finds one-cell pipes touching the first or last cell of another pipe with the same `color_index`, tests both orientations of the target path, preserves the five-cell straight-run limit, and accepts the merge only when the complete level still has a valid removal order. Accepted merges compact pipe IDs and rebuild occupancy before the next pass.

### `calculate_fixed_direction_solution_order(grid, pipes)`

**Location:** line 1765. **Kind:** function.


Builds a deterministic removal order for already assigned directions by repeatedly finding currently clear pipes.

### `split_pipes_to_straight_limit(grid, pipes)`

**Location:** line 1830. **Kind:** function.


Divides pipes when necessary so every resulting piece obeys the maximum five-cell straight-run rule.

### `carve_pipes(grid, random, length_setting, nesting_setting, exact_cover_mode = false)`

**Location:** line 1926. **Kind:** function.


Partitions all valid mask cells into non-overlapping pipe paths, assigns directions and a solution order, and returns aggregate style metrics. In creator exact-cover mode it must cover every valid cell even when small fallback pipes are required.

### `calculate_orientation_data(grid, pipe, orientation)`

**Location:** line 2155. **Kind:** function.


Analyzes blockers, exit distance, contact geometry, and scoring information for one of a pipe's two possible endpoint orientations.

### `assign_solvable_orientations(grid, pipes, random, nesting_setting = 0)`

**Location:** line 2227. **Kind:** function.


Searches endpoint-direction assignments that produce a complete valid removal order and favor nested dependency structure.

### `calculate_difficulty(level)`

**Location:** line 2382. **Kind:** function.


Builds the static blocker graph and reports pipe count, segment count, initially open pipes, maximum dependency depth, and average pipe length.

### `depth(pipe_id, visiting)`

**Location:** line 2415. **Kind:** function.


Recursive memoized helper used by calculate_difficulty to measure dependency-chain depth while avoiding cycles.

### `generate_level(options)`

**Location:** line 2459. **Kind:** function.


Top-level mask-to-level generator. It validates dimensions, prepares the mask, retries deterministic seeds, carves full pipe coverage, enforces style/solvability rules, and returns canonical level data with difficulty metadata.

### `normalize_level(raw_level)`

**Location:** line 2619. **Kind:** function.


Converts raw JSON-like level data into canonical numeric objects, validates it, and calculates difficulty when absent.

### `validate_level(level)`

**Location:** line 2696. **Kind:** function.


Enforces the complete level contract: dimensions, mask length, unique IDs, orthogonal contiguous cells, no overlap, mask coverage rules, legal direction vectors, straight-run limits, and a valid complete solution order.

### `serialize_level(level)`

**Location:** line 2846. **Kind:** function.


Normalizes a level and converts object cells/directions back into compact array-based JSON-safe data.

### `PuzzleSession.constructor(raw_level)`

**Location:** line 2872. **Kind:** method.


Initializes a new instance, creates its owned state, normalizes required dependencies, and establishes the invariants that every later method assumes.

### `PuzzleSession.reset()`

**Location:** line 2889. **Kind:** method.


Restores a PuzzleSession to a fresh mutable copy of its immutable source level.

### `PuzzleSession.rebuild_occupancy()`

**Location:** line 2909. **Kind:** method.


Reconstructs the grid's pipe-ID occupancy array from active in-bounds pipe cells.

### `PuzzleSession.mark_state_changed()`

**Location:** line 2923. **Kind:** method.


Increments the session state version and clears collision caches that depend on geometry.

### `PuzzleSession.get_pipe(pipe_id)`

**Location:** line 2928. **Kind:** method.


Returns a mutable runtime pipe by ID.

### `PuzzleSession.get_active_count()`

**Location:** line 2932. **Kind:** method.


Counts pipes still active on or moving through the board.

### `PuzzleSession.get_moving_count()`

**Location:** line 2936. **Kind:** method.


Returns the number of pipes currently moving.

### `PuzzleSession.is_complete()`

**Location:** line 2940. **Kind:** method.


Returns true when no active pipes remain.

### `PuzzleSession.can_activate(pipe_id)`

**Location:** line 2944. **Kind:** method.


Determines whether a pipe may begin moving, distinguishing nonexistent, inactive, already-moving, stationary-blocked, moving-collision, and valid cases.

### `PuzzleSession.get_stationary_blocker(pipe)`

**Location:** line 2978. **Kind:** method.


Scans the arrow ray for the first nonmoving active pipe occupying the path.

### `PuzzleSession.get_moving_collision(candidate_pipe)`

**Location:** line 3001. **Kind:** method.


Checks the candidate against every currently moving pipe using swept-cell rejection and detailed temporal geometry simulation.

### `PuzzleSession.get_cached_swept_cell_set(pipe)`

**Location:** line 3038. **Kind:** method.


Returns a state-version-keyed set of all grid cells a pipe can sweep through on its way off the board.

### `PuzzleSession.create_swept_cell_set(pipe)`

**Location:** line 3050. **Kind:** method.


Builds the conservative swept-cell set for a pipe's complete future motion.

### `PuzzleSession.cell_sets_overlap(left, right)`

**Location:** line 3071. **Kind:** method.


Quickly tests whether two swept-cell sets share any cell.

### `PuzzleSession.simulate_pair_collision(candidate_pipe, moving_pipe, moving_progress)`

**Location:** line 3084. **Kind:** method.


Advances two pipes through normalized time to detect crossing, overlap, contact, or position swapping during concurrent movement.

### `PuzzleSession.create_simulation_state(pipe, progress)`

**Location:** line 3137. **Kind:** method.


Creates a lightweight simulated pipe position at a fractional movement progress.

### `PuzzleSession.advance_simulation_state(state, delta)`

**Location:** line 3152. **Kind:** method.


Advances a simulated pipe state by a normalized amount, including whole-cell steps.

### `PuzzleSession.simulation_states_collide(left_state, right_state)`

**Location:** line 3175. **Kind:** method.


Tests two simulation states for duplicate cells, segment intersections, or insufficient polyline separation.

### `PuzzleSession.get_simulation_render_cells(state)`

**Location:** line 3188. **Kind:** method.


Converts a simulation state into interpolated polyline points.

### `PuzzleSession.polylines_collide(left_points, right_points, minimum_distance)`

**Location:** line 3212. **Kind:** method.


Tests all segment pairs between two polylines using bounds rejection and exact distance/intersection checks.

### `PuzzleSession.segment_bounds_overlap(left_start, left_end, right_start, right_end, padding)`

**Location:** line 3258. **Kind:** method.


Fast axis-aligned bounding-box overlap test for two segments with optional padding.

### `PuzzleSession.segment_distance_squared(left_start, left_end, right_start, right_end)`

**Location:** line 3290. **Kind:** method.


Returns the squared minimum distance between two line segments, including intersection cases.

### `PuzzleSession.segments_intersect(left_start, left_end, right_start, right_end)`

**Location:** line 3329. **Kind:** method.


Robustly determines whether two finite segments intersect or touch.

### `PuzzleSession.cross_product(start, end, point)`

**Location:** line 3413. **Kind:** method.


Returns the signed 2D cross product used for orientation tests.

### `PuzzleSession.point_on_segment(point, start, end, epsilon)`

**Location:** line 3420. **Kind:** method.


Checks whether a collinear point lies within a segment's bounds.

### `PuzzleSession.point_segment_distance_squared(point, start, end)`

**Location:** line 3429. **Kind:** method.


Returns squared distance from a point to the nearest point on a segment.

### `PuzzleSession.activate(pipe_id)`

**Location:** line 3465. **Kind:** method.


Calls can_activate and, on success, places the pipe in the moving map at zero progress and increments move count.

### `PuzzleSession.get_removable_pipe_ids()`

**Location:** line 3478. **Kind:** method.


Returns IDs of all pipes that can legally be activated in the current concurrent state.

### `PuzzleSession.update(delta_milliseconds)`

**Location:** line 3490. **Kind:** method.


Advances every moving pipe according to elapsed milliseconds, performs whole-cell steps, rebuilds occupancy, and reports completed pipe IDs.

### `PuzzleSession.advance_pipe_step(pipe_id)`

**Location:** line 3522. **Kind:** method.


Moves one pipe forward by one grid step, then deactivates it once every segment lies outside the grid.

### `PuzzleSession.get_render_cells(pipe_id)`

**Location:** line 3552. **Kind:** method.


Returns interpolated cell coordinates for drawing a stationary or moving pipe.

### `ease_in_out(value)`

**Location:** line 3585. **Kind:** function.


Quadratic ease-in/ease-out interpolation used to smooth per-cell movement.

## Level creator canvas renderer function reference

Source: `creator/js/canvas_renderer.js`. Line numbers refer to the documented build.

### `CanvasRenderer.constructor(canvas)`

**Location:** line 5. **Kind:** method.


Initializes a new instance, creates its owned state, normalizes required dependencies, and establishes the invariants that every later method assumes.

### `get CanvasRenderer.show_mask()`

**Location:** line 18. **Kind:** getter.


Returns whether the valid-cell mask background is currently visible.

### `set CanvasRenderer.show_mask(value)`

**Location:** line 22. **Kind:** setter.


Changes mask visibility and invalidates the static background cache when the value changes.

### `CanvasRenderer.set_level(level)`

**Location:** line 31. **Kind:** method.


Sets level. This is an internal method in `creator/js/canvas_renderer.js`; its inputs are given by the signature and it participates in the surrounding subsystem described above.

### `CanvasRenderer.resize()`

**Location:** line 37. **Kind:** method.


Sizes the game canvas from fixed 12-pixel cells, board dimensions, padding, zoom, and render-memory limits.

### `CanvasRenderer.pointer_to_cell(event)`

**Location:** line 70. **Kind:** method.


Converts a client pointer position through CSS scaling back into an integer grid coordinate or null.

### `CanvasRenderer.render(session, visual_state = {})`

**Location:** line 100. **Kind:** method.


Draws the cached board, pipes, guides, motion, states, and effects for one animation frame.

### `CanvasRenderer.ensure_background_cache()`

**Location:** line 164. **Kind:** method.


Rebuilds the offscreen static board cache only when level, size, or mask visibility changes.

### `CanvasRenderer.draw_board_background(context)`

**Location:** line 189. **Kind:** method.


Paints the dark board surface, valid-cell mask, subtle depth, and static grid into the cache.

### `CanvasRenderer.draw_grid(context)`

**Location:** line 225. **Kind:** method.


Draws restrained grid lines over valid cells.

### `CanvasRenderer.draw_exit_guide(context, session, visual_state)`

**Location:** line 267. **Kind:** method.


Draws the directional continuation guide for a hovered, hinted, or moving pipe.

### `CanvasRenderer.draw_pipe(context, session, pipe, visual_state, time)`

**Location:** line 329. **Kind:** method.


Draws one pipe's outline, inner stroke, moving interpolation, state emphasis, arrow, streaks, and endpoint treatment.

### `CanvasRenderer.get_intro_alpha(pipe_id, time, intro_started)`

**Location:** line 467. **Kind:** method.


Returns staggered introduction opacity for a pipe after level load.

### `CanvasRenderer.draw_speed_streaks(context, points, direction, color, cell_size, time, pipe_id)`

**Location:** line 481. **Kind:** method.


Draws short motion trails behind a moving pipe.

### `CanvasRenderer.draw_motion_tip(context, tip, color, cell_size, time, pipe_id)`

**Location:** line 521. **Kind:** method.


Draws a highlighted leading tip on a moving pipe.

### `CanvasRenderer.draw_effects(context, effects, time, layer)`

**Location:** line 541. **Kind:** method.


Dispatches active effects by layer and effect type.

### `CanvasRenderer.draw_ripple(context, effect, progress)`

**Location:** line 569. **Kind:** method.


Draws the activation ripple at the selected cell.

### `CanvasRenderer.draw_launch(context, effect, progress)`

**Location:** line 584. **Kind:** method.


Draws the short forward impulse at a pipe head.

### `CanvasRenderer.draw_impact(context, effect, progress)`

**Location:** line 621. **Kind:** method.


Draws blocked-tap impact feedback.

### `CanvasRenderer.draw_burst(context, effect, progress)`

**Location:** line 647. **Kind:** method.


Draws particles when a pipe clears the board.

### `CanvasRenderer.draw_celebration(context, effect, progress)`

**Location:** line 679. **Kind:** method.


Draws the level-completion celebration.

### `CanvasRenderer.noise(seed, index)`

**Location:** line 709. **Kind:** method.


Returns a deterministic pseudo-random scalar for visual particles/streaks.

### `CanvasRenderer.grid_point_to_canvas(grid_x, grid_y)`

**Location:** line 717. **Kind:** method.


Converts logical grid coordinates into canvas coordinates.

### `CanvasRenderer.cell_center(grid_x, grid_y)`

**Location:** line 724. **Kind:** method.


Returns the canvas center of a grid cell.

### `CanvasRenderer.stroke_polyline(context, points, color, width)`

**Location:** line 728. **Kind:** method.


Strokes a rounded polyline through a list of canvas points.

### `CanvasRenderer.draw_arrow(context, center, direction, outer_color, inner_color, outer_width, inner_width, cell_size)`

**Location:** line 741. **Kind:** method.


Draws the open line-tool-style arrow structure at the pipe head.


## Service worker event and helper reference

Source: `game/service-worker.js`.

### `install` event listener

Opens the versioned static cache and atomically adds every `APP_SHELL` URL. Installation fails if a required precache URL cannot be fetched.

### `activate` event listener

Deletes obsolete Choobs caches, enables navigation preload where supported, and claims current clients.

### `message` event listener

Accepts `{type: "SKIP_WAITING"}` and immediately activates the waiting worker.

### `fetch` event listener

Routes same-origin GET requests by request type. Navigation uses `handle_navigation`; JSON uses `network_first`; other assets use `cache_first_with_refresh`.

### `handle_navigation(event)`

Uses navigation preload or network first, runtime-caches successful responses, then falls back to an exact cached request or static `index.html` when offline.

### `network_first(request)`

Fetches JSON from the network, caches successful data, and falls back to any cached response on failure.

### `cache_first_with_refresh(request)`

Returns a cached asset immediately when present and refreshes it in the background. On a miss, fetches and runtime-caches it.

### `refresh_in_background(request)`

Fetches an already cached asset without blocking the response and updates the runtime cache if successful.

## Data-only JavaScript files

### `game/js/levels.js`

Defines `window.CHOOBS_LEVELS` with the bundled tutorials. It intentionally contains data rather than named runtime functions.

### `creator/js/levels.js`

Defines an empty compatibility level array for the standalone creator.

### `creator/js/generation_worker_source.js`

Defines `globalThis.ChoobsGenerationWorkerSource` as one serialized JavaScript string. That string contains the creator engine plus a worker `message` listener. The worker accepts `{type:"generate", options}`, injects an `on_progress` callback, calls `Choobs.generate_level`, and posts `progress`, `complete`, or `error` messages.

# DOM element reference

## Game DOM IDs

- **`#level_select`** — Native selector containing every known level up to the progression frontier.
- **`#heartbeat_meter`** — Three-heart strike meter shown only in Heartbeat and Permadeath.
- **`#menu_button`** — Top-right hamburger button opening the pause sheet.
- **`#score_value`** — Formatted run-score value.
- **`#combo_hud`** — Live multiplier and timer group.
- **`#combo_value`** — Current combo text.
- **`#combo_fill`** — Transform-scaled timer fill.
- **`#score_effects_layer`** — DOM layer for floating +points feedback.
- **`#board_stage`** — Scrollable/pannable viewport around the fixed-size board.
- **`#canvas_frame`** — Board visual wrapper used for failure and celebration classes.
- **`#game_canvas`** — Canvas receiving board rendering and gameplay taps.
- **`#loading_overlay`** — Branded loading cover.
- **`#win_overlay`** — Completion result sheet.
- **`#win_title`** — Completion level/title heading.
- **`#win_score`** — Completion run-score field.
- **`#win_level_points`** — Points earned during the completed level.
- **`#win_best_combo`** — Best run combo.
- **`#continue_button`** — Loads the next numerical level.
- **`#continue_button_label`** — Dynamic Next level text.
- **`#replay_button`** — Restarts the completed level.
- **`#status_text`** — Screen-reader live status.
- **`#level_import_input`** — Hidden multiple JSON file input.
- **`#pause_overlay`** — Modal pause backdrop and sheet.
- **`#pause_title`** — Pause dialog title.
- **`#pause_score_badge`** — Current run score in pause header.
- **`#pause_level_badge`** — Current level in pause header.
- **`#resume_button`** — Closes pause menu.
- **`#restart_menu_button`** — Restarts current level.
- **`#pause_mode_name`** — Human-readable selected mode.
- **`#pause_mode_description`** — Selected-mode consequence text.
- **`#reset_game_button`** — Opens destructive reset confirmation.
- **`#install_app_button`** — Conditional PWA installation action.
- **`#close_app_button`** — Saves and attempts to leave/close.
- **`#reset_confirmation`** — Nested reset alert dialog.
- **`#reset_title`** — Reset alert title.
- **`#reset_description`** — Reset consequence text.
- **`#cancel_reset_button`** — Safe cancellation action.
- **`#confirm_reset_button`** — Executes full reset.
- **`#close_overlay`** — Saved-progress fallback screen.
- **`#close_title`** — Saved-progress heading.
- **`#return_to_game_button`** — Returns from fallback close screen.
- **`#mode_overlay`** — First-run mode chooser.
- **`#mode_title`** — Mode chooser heading.
- **`#install_overlay`** — Manual iOS installation dialog.
- **`#close_install_button`** — Closes install instructions.
- **`#install_title`** — Install dialog heading.
- **`#dismiss_install_button`** — Done button for install instructions.
- **`#pwa_update_toast`** — Update-ready notification.
- **`#apply_update_button`** — Activates waiting service worker.
- **`#pwa_connection_toast`** — Temporary network-state notification.
- **`#pwa_connection_message`** — Online/offline message text.

## Creator DOM IDs

- **`#level_number_input`** — Level number stored in JSON and filename.
- **`#level_name_input`** — Manual level display name.
- **`#image_input`** — Image upload accepting image/*.
- **`#default_image_button`** — Restores built-in binary blob.
- **`#source_name_text`** — Displays source/preprocessing/white-pixel summary.
- **`#grid_size`** — Hidden fixed value 50.
- **`#grid_size_output`** — Hidden compatibility output.
- **`#white_majority`** — Hidden compatibility threshold value.
- **`#white_majority_output`** — Hidden compatibility output.
- **`#pipe_length_output`** — Human-readable Short/Medium/Long label.
- **`#pipe_length`** — Three-step length control.
- **`#nesting_output`** — Human-readable nesting label.
- **`#nesting`** — Four-step nesting control.
- **`#seed_input`** — Unsigned generation seed.
- **`#random_seed_button`** — Generates a new seed.
- **`#generate_button`** — Runs generation.
- **`#export_button`** — Exports current JSON.
- **`#import_input`** — Loads one level JSON.
- **`#editor_status`** — Live generation and test status.
- **`#hint_button`** — Highlights a removable pipe.
- **`#reset_test_button`** — Restarts preview.
- **`#show_mask`** — Toggles mask background.
- **`#canvas_frame`** — Preview wrapper.
- **`#editor_canvas`** — Playable preview canvas.
- **`#loading_overlay`** — Generation busy cover.
- **`#valid_cell_count`** — White-mask cell count.
- **`#pipe_count`** — Generated pipe count.
- **`#open_count`** — Currently removable count.
- **`#depth_count`** — Static dependency depth.
- **`#overwrite_notice`** — Hidden legacy library state.
- **`#delete_button`** — Hidden legacy control.
- **`#refresh_library_button`** — Hidden legacy control.
- **`#server_badge`** — Hidden legacy standalone status.
- **`#level_library_list`** — Hidden optional in-memory list.
- **`#source_canvas`** — Hidden exact 50×50 binary source canvas.

# CSS selector inventory

The lists below are an exhaustive selector inventory, not a style tutorial. Media-query and keyframe bodies are represented by their ordinary selectors where extractable.


## Game selectors

- `#game_canvas`
- `*`
- `*::after`
- `*::before`
- `.board_scroller_content`
- `.board_stage`
- `.board_stage::-webkit-scrollbar`
- `.brand_lockup`
- `.brand_mark`
- `.brand_mark svg`
- `.brand_name`
- `.canvas_frame`
- `.canvas_frame.is-celebrating`
- `.canvas_frame.is-failing`
- `.canvas_frame::after`
- `.close_card`
- `.close_card .secondary_button`
- `.close_card > p:not(.completion_eyebrow)`
- `.close_card h1`
- `.close_mark`
- `.close_mark svg`
- `.close_overlay`
- `.combo_copy`
- `.combo_copy span`
- `.combo_copy strong`
- `.combo_hud`
- `.combo_track`
- `.combo_track span`
- `.completion_eyebrow`
- `.completion_mark`
- `.completion_mark svg`
- `.completion_stats`
- `.completion_stats div`
- `.completion_stats span`
- `.completion_stats strong`
- `.danger_button`
- `.danger_button:active`
- `.game_hud`
- `.game_shell`
- `.game_surface`
- `.heart`
- `.heart.is_lost`
- `.heartbeat_meter`
- `.heartbeat_meter.is_hit`
- `.hidden`
- `.hud_actions`
- `.install_card`
- `.install_card h1`
- `.install_close_button`
- `.install_done_button`
- `.install_icon`
- `.install_icon img`
- `.install_overlay`
- `.install_step_number`
- `.install_steps`
- `.install_steps li`
- `.level_caption`
- `.level_picker`
- `.level_picker select`
- `.level_picker select:focus-visible`
- `.loading_bar`
- `.loading_bar span`
- `.loading_brand`
- `.loading_brand svg`
- `.loading_overlay`
- `.menu_button`
- `.menu_button svg`
- `.menu_button:active`
- `.menu_button:hover`
- `.mode_arrow`
- `.mode_brand`
- `.mode_brand_mark`
- `.mode_brand_mark svg`
- `.mode_copy`
- `.mode_description`
- `.mode_dialog`
- `.mode_dialog h1`
- `.mode_heading`
- `.mode_icon`
- `.mode_icon svg`
- `.mode_intro`
- `.mode_kicker`
- `.mode_name`
- `.mode_option`
- `.mode_option:active`
- `.mode_option:hover`
- `.mode_option_danger .mode_icon`
- `.mode_option_danger:hover`
- `.mode_options`
- `.mode_overlay`
- `.pause_badges`
- `.pause_grabber`
- `.pause_group`
- `.pause_header`
- `.pause_header h1`
- `.pause_kicker`
- `.pause_level_badge`
- `.pause_mode_choices`
- `.pause_mode_choices button`
- `.pause_mode_choices button.is_selected`
- `.pause_mode_choices button:active`
- `.pause_mode_choices button:hover`
- `.pause_mode_choices button[data-pause-mode="permadeath"].is_selected`
- `.pause_mode_control`
- `.pause_mode_description`
- `.pause_mode_heading`
- `.pause_mode_heading strong`
- `.pause_overlay`
- `.pause_resume`
- `.pause_resume svg`
- `.pause_row`
- `.pause_row:active`
- `.pause_row:hover`
- `.pause_row:last-child`
- `.pause_row_arrow`
- `.pause_row_copy`
- `.pause_row_copy small`
- `.pause_row_copy strong`
- `.pause_row_danger .pause_row_icon`
- `.pause_row_danger:hover`
- `.pause_row_icon`
- `.pause_row_icon svg`
- `.pause_sheet`
- `.pause_sheet::-webkit-scrollbar`
- `.primary_button`
- `.primary_button svg`
- `.primary_button:active`
- `.primary_button:hover`
- `.pwa_connection_toast`
- `.pwa_toast`
- `.pwa_toast button`
- `.pwa_toast button:disabled`
- `.reset_actions`
- `.reset_confirmation`
- `.reset_confirmation h2`
- `.reset_confirmation p`
- `.score_burst`
- `.score_burst small`
- `.score_chip`
- `.score_chip span`
- `.score_chip strong`
- `.score_chip.is_bumping`
- `.score_effects_layer`
- `.score_stack`
- `.screen_reader_only`
- `.secondary_button`
- `.secondary_button svg`
- `.secondary_button:active`
- `.secondary_button:hover`
- `.select_chevron`
- `.win_actions`
- `.win_card`
- `.win_card h1`
- `.win_overlay`
- `:root`
- `body`
- `button`
- `button:disabled`
- `button:focus-visible`
- `canvas:focus-visible`
- `html`
- `input`
- `select`
- `select:focus-visible`

## Creator selectors

- `#editor_canvas`
- `#image_input`
- `#import_input`
- `*`
- `*::after`
- `*::before`
- `.app_header`
- `.app_layout`
- `.brand`
- `.brand_context`
- `.brand_mark`
- `.brand_name`
- `.button`
- `.button:has(input:disabled)`
- `.button_full`
- `.button_ghost`
- `.button_ghost:hover`
- `.button_primary`
- `.button_primary:hover`
- `.button_secondary`
- `.button_secondary:hover`
- `.button_small`
- `.canvas_frame`
- `.canvas_panel`
- `.editor_canvas_frame`
- `.field_group + .field_group`
- `.field_group > label`
- `.field_help`
- `.fixed_setting_row`
- `.fixed_setting_row strong`
- `.header_actions`
- `.header_actions .button`
- `.header_inner`
- `.hidden`
- `.loading_overlay`
- `.loading_overlay p`
- `.metric`
- `.metric span`
- `.metric strong`
- `.metric:last-child`
- `.metric:nth-child(-n + 2)`
- `.metric:nth-child(2)`
- `.metrics_bar`
- `.preview_actions`
- `.preview_header`
- `.preview_heading p`
- `.preview_panel`
- `.range_group`
- `.range_group + .field_group`
- `.range_group + .range_group`
- `.range_group:first-of-type`
- `.range_header`
- `.range_header label`
- `.range_header output`
- `.screen_reader_only`
- `.seed_control`
- `.settings_footer`
- `.settings_intro`
- `.settings_intro p`
- `.settings_panel`
- `.settings_section`
- `.settings_section:nth-of-type(3)`
- `.source_file`
- `.source_file_actions`
- `.source_file_info`
- `.source_file_info strong`
- `.source_file_label`
- `.spinner`
- `.switch_control`
- `.switch_control input`
- `:root`
- `body`
- `button`
- `button:disabled`
- `button:focus-visible`
- `canvas:focus-visible`
- `h1`
- `h2`
- `html`
- `input`
- `input:focus-visible`
- `input[type="number"]`
- `input[type="number"]:hover`
- `input[type="range"]`
- `input[type="text"]`
- `input[type="text"]:hover`
- `label.button:focus-within`
- `label[for]`
- `p`
- `select`
- `select:focus-visible`
- `select:hover`

# Glossary

- **Active pipe:** A pipe not yet fully removed.
- **Arrow ray:** The sequence of grid cells extending from the pipe head in its direction.
- **Blocker:** A different pipe occupying or sweeping through a candidate's future path.
- **Cell:** One integer grid coordinate.
- **Combo:** Consecutive valid activations within the shrinking timer.
- **Dependency depth:** Longest static chain of pipes blocking pipes.
- **Exact cover:** Every valid mask cell belongs to exactly one pipe and no invalid cell belongs to any pipe.
- **Frontier:** Boundary between already occupied structure and remaining available cells during generation.
- **Head:** Final ordered cell of a pipe, where the arrow is drawn.
- **Hilbert curve:** Space-filling curve used as the procedural source route.
- **Mask:** Row-major binary array defining valid puzzle cells.
- **Manual level:** Bundled, imported, or hosted JSON level that overrides procedural generation.
- **Moving pipe:** Active pipe with fractional movement progress.
- **Nesting:** Structural contour-following and wrapping around neighboring pipes.
- **Occupancy:** Mapping from in-bounds cells to active pipe IDs.
- **Perpendicular aim:** Arrow ray whose first target segment runs at 90 degrees.
- **Pipe:** Ordered nonbranching orthogonal path with one direction.
- **Procedural placeholder:** Lightweight level entry resolved only when opened.
- **Run:** Progress and score from Level 1 until reset or Permadeath.
- **Singleton:** One-cell pipe, allowed by creator fallback when exact coverage makes it necessary.
- **Solution order:** Pipe-ID sequence that solves a level sequentially.
- **Swept cells:** Conservative set of cells a pipe can occupy during all future motion.
- **Turn density:** Turns divided by total segments.
- **Valid cell:** Mask value 1.
- **Warbled mask:** Organic procedural silhouette with irregular edges, dents, lobes, and holes.

---

# End of master README

This README is intentionally a source-level specification. When behavior changes, update the relevant feature section, persistence schema, level-format section, test checklist, function reference, service-worker version instructions, and file inventory together.

# 50×50 five-colour build function amendment

The following named routines were added or materially changed after the original exhaustive function catalogue was generated. Source line numbers in the older catalogue are therefore approximate; function names and behavior remain authoritative.

## Game engine and procedural generator

- `normalize_palette(raw_palette)` — validates, deduplicates, lowercases, and completes a level palette to exactly five six-digit hexadecimal colours.
- `hsl_to_hex(hue, saturation, lightness)` — converts deterministic HSL palette values into `#rrggbb` strings.
- `create_random_palette(seed)` — creates five high-saturation hues separated around the colour wheel, adds seeded jitter, then shuffles their order. The same level number always receives the same palette.
- `create_level_profile(level_number)` — now clamps every procedural size to 10–50, makes Level 50 exactly 50×50, and samples Levels 51 onward only from 10–50.

## Creator image preparation

- `color_distance_squared(left, right)` — squared RGB distance used for background detection and clustering.
- `rgb_to_hex(color)` / `hex_to_rgb(value)` — conversions used by quantisation and source preview rendering.
- `choose_background_color(pixels)` — examines the 50×50 border and returns a dark dominant background only when it occupies at least 28% of border samples.
- `analyze_source_pixels / choose_automatic_palette / quantize_pixels_to_palette(pixels)` — builds the occupancy mask, performs weighted five-colour clustering, assigns one palette index per visible pixel, and fills missing palette slots from the fallback colours.
- `draw_quantized_source()` — renders the five-colour source map into the hidden 50×50 canvas, with empty cells rendered black.
- `update_palette_preview()` — rebuilds the five visible palette swatches in the creator sidebar.

## Creator exact-cover engine

- `split_pipes_by_color(grid, pipes, color_map)` — divides a generated route at every source-colour transition and turns the chunks into an acyclic dependency chain. Every resulting pipe contains only cells with its own `color_index`.
- `build_fast_frontier_candidates(grid, available)` — finds current row and column extrema for the large-mask exact-cover path.
- `fast_exact_color_cover(grid, random, length_setting, color_map)` — generates large 50×50 colour-aware levels in deterministic frontier order. It preserves every valid cell, respects five-cell straight-run limits, and creates a valid solution order without the costly orphan-search loop used for smaller artistic masks.

## Level schema amendment

Version-3 levels may include:

```json
"palette": ["#ff5c7a", "#ffd166", "#4dd6a8", "#5b9dff", "#b983ff"]
```

`color_index` is resolved against this level-specific array. Older levels without `palette` remain compatible and receive the built-in five-colour fallback.

