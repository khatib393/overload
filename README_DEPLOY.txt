# Overload — production deployment (public-safe code only)

**Upload these six files to the repository ROOT `khatib393/overload` (NOT into `preview/`):**

- `index.html` — replaces the old app UI
- `app.js` — new tracker
- `styles.css` — 3 theme design
- `sw.js` — offline support
- `manifest.webmanifest` — home-screen install manifest
- `icon.svg` — new favicon

The original `icon-180.png`, `icon-192.png`, and `icon-512.png` must be KEPT where they are; the updated manifest references them.

**Never upload your workout TXT, personal plan JSON, backups, screenshots, or any individual health records.**

## Before overwriting

1. Confirm your phone has downloaded the `overload-private-backup-YYYY-MM-DD.json` file in its private Downloads/Files area.
2. Do not clear Safari/Chrome or home-screen app data; the new application reuses IndexedDB `overload-private-v2` from the working preview at the same web origin.
3. Upload `app.js`, `styles.css`, `icon.svg`, `manifest.webmanifest`, `sw.js` FIRST, and `index.html` LAST. GitHub retains the old version in commit history for rollback.
4. Refresh `https://khatib393.github.io/overload/` in the *same browser*, check Training history, plan and theme switching. If loading from Home Screen and data is missing, import your verified backup via Settings → Restore backup. Do not delete the backup.
5. The old food photos are **not** migrated. Their blobs remain in the old browser IndexedDB unless cleared. If you need them, preserve them separately before clearing data; simply replacing HTML does not delete old data.
6. Leave `/preview/` untouched until main app and data are verified. You can remove it later as a separate task.
