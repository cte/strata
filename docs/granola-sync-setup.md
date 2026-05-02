# Granola Sync Setup

Use this path when Granola API access is unavailable. The goal is to move exported transcripts from macOS into `wiki/raw/granola/` without requiring the Linux agent to know about local Mac paths.

## Assumptions

- The wiki repo is available on the Mac, or the Mac can reach a synced folder or remote git repository.
- Granola exports Markdown transcripts to a local folder chosen by the user.
- The sync job only creates new raw files. It should not rewrite existing transcripts.

## launchd job

Create `~/Library/LaunchAgents/dev.exe.cortex.granola-sync.plist` on the Mac:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.exe.cortex.granola-sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>$HOME/bin/granola-sync-to-wiki.sh</string>
  </array>
  <key>StartInterval</key>
  <integer>900</integer>
  <key>StandardOutPath</key>
  <string>/tmp/granola-sync-to-wiki.out</string>
  <key>StandardErrorPath</key>
  <string>/tmp/granola-sync-to-wiki.err</string>
</dict>
</plist>
```

Load it:

```sh
launchctl load ~/Library/LaunchAgents/dev.exe.cortex.granola-sync.plist
```

## Git remote option

Create `~/bin/granola-sync-to-wiki.sh`:

```sh
#!/bin/zsh
set -euo pipefail

EXPORT_DIR="$HOME/Documents/Granola Exports"
CORTEX_DIR="$HOME/Documents/cortex"

mkdir -p "$CORTEX_DIR/wiki/raw/granola"
rsync -a --ignore-existing "$EXPORT_DIR/" "$CORTEX_DIR/wiki/raw/granola/"

cd "$CORTEX_DIR"
if ! git diff --quiet -- wiki/raw/granola; then
  git add wiki/raw/granola
  git commit -m "ingest: granola | mac sync"
  git push
fi
```

## Synced folder option

If the wiki lives in iCloud, Dropbox, Syncthing, or another synced folder, keep the same script but omit `git push`. The Linux-side agent should pull or read from the synced location before ingesting.

## Validation

After the first run, confirm:

- New files appear under `wiki/raw/granola/`.
- Re-running the job does not duplicate files.
- Existing raw files are not modified.
