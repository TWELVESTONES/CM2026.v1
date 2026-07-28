## CloudMerge v0.1.7 — fix: symlink mount error, and folders now show friendly names too

Two more fixes from testing v0.1.6 on a real machine:

### "CloudMerge added the account but could not refresh the connected folder" (symlinks error)

After v0.1.6 got the folder actually mounting, adding another account could
throw: `ERROR : symlinks not supported without the --links flag: /`. This
turns out to be a routine Windows/WinFsp quirk, not anything specific to
CloudMerge or your accounts — WinFsp checks every mount's root for whether
it's a symlink as a normal part of setting up, and rclone refuses to answer
that check at all unless you tell it symlinks are okay to represent. Plain
Linux/macOS FUSE doesn't do this check, which is why it never showed up
before. Fixed by passing `--vfs-links`, which is also just the fix rclone's
own error message points you to.

While fixing this we also noticed the mount code was treating *any* line
rclone logged containing the word "error" as a fatal failure — even one-off,
non-fatal notices about a single item, while the mount itself kept running
fine. That's now fixed too: only genuine "the mount never started" failures
are treated as a failure; a per-item hiccup no longer produces a false
"could not connect the folder" report.

### Folders weren't using friendly names either

The friendly-name lookup added in v0.1.3 only ever fed the account list
*inside* the CloudMerge window — the actual `~/CloudMerge` folder's
subfolders were always named after the technical rclone remote (e.g.
`google_drive-ms4up8n3`), even once a friendly name had been found. Since
the folder is the main way you actually use CloudMerge, this was the more
important place for it to show up. Fixed: subfolders are now named like
`Google Drive — jamesfw@gmail.com` once an identity has been looked up
(falling back to the technical name until then, same as before).

### If you already have v0.1.0–v0.1.6 installed

Safe drop-in upgrade, no need to uninstall first, and no need to reconnect
any accounts. After upgrading, existing accounts' folders will rename
themselves to the friendly format automatically once CloudMerge finishes
looking up each one (this can take a few seconds after opening; no action
needed on your end).

See the [v0.1.6 release notes](https://github.com/TWELVESTONES/CM2026.v1/releases/tag/v0.1.6)
and [v0.1.0 release notes](https://github.com/TWELVESTONES/CM2026.v1/releases/tag/v0.1.0)
for prior fixes and the full feature list/known limitations (Windows only,
unsigned installer, personal-scale OAuth).
