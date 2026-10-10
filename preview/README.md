# Overload private-data-safe preview

This **preview/** folder contains only public HTML, CSS, JavaScript, icons and offline shell. User logs, plan JSON, browser backups, FITBIT exports, weight, food and personally identifying data are not part of it.

The existing `index.html` at the root of the repository stays unchanged. The target after uploading this folder is `/overload/preview/`.

## Private setup

1. Open the preview on the SAME iPhone/browser or PWA installation where the old log was recorded. Classic localStorage key `overload-log-v1` is never removed.
2. If the old workout data is found, tap **Import safely**; otherwise in Settings choose **Import workout text (.txt)** and pick the separate PRIVATE workout import file. The import merges by exercise/date/set index and is repeat-safe.
3. In Settings, import the separate PRIVATE `81-Day Plan` JSON saved on your phone. It is not part of this public package.
4. Export a private JSON backup, save it to private Drive, and verify your 20 exercise names, workout sessions, latest weight and entries across a reload.
5. Do NOT retire or erase the classic app yet. Old food photos are not migrated into this build. The classic page remains available at the root and its data in the `overload-photos` IndexedDB remains untouched.

## Appearance

Automatic 07:00 Light, 17:00 Dark, 22:00 Black AMOLED, Stockholm time. Manual override and editable hours are under Settings. The app's 04:00 day boundary is also Stockholm based.

## Security and limits

No server, analytics, auth, API sync, automatic Drive backup, or export to GitHub. Logs are stored in browser IndexedDB, where they can be erased by system/browser changes. The only backup is the user's manually downloaded file. Personal JSON backups and TXT histories are readable private data; do not share them or commit them.

The public `preview/` loads only from the local repository and its own icon assets at the parent directory. Production is unchanged until a separate explicit decision to replace it.
