# GitHub Pages deployment

This package is arranged so the game entry file, `index.html`, is at the repository root.

1. Delete the old nested `Choobs/` game folder from the repository.
2. Upload the contents of this package directly to the repository root on `main`.
3. In GitHub, open **Settings → Pages**.
4. Select **Deploy from a branch**.
5. Select branch **main** and folder **/(root)**.
6. Save and wait for the Pages deployment workflow to complete.

The game will be served at:

`https://cambelljsmith.github.io/Choobs/`

The level creator will be served at:

`https://cambelljsmith.github.io/Choobs/creator/`

Do not upload the enclosing ZIP folder as another directory. `index.html`, `service-worker.js`, `manifest.webmanifest`, `js/`, and `levels/` must be visible at the repository root.

## Updating an existing installation

This release changes the service-worker cache version. After the files are deployed, an installed PWA will detect the update. Apply the in-game update prompt or close and reopen the installed app after the new service worker activates.
