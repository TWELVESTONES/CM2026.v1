## CloudMerge v0.1.8 — fix: silent mount failures, folder-not-found error, stuck friendly names

Three more fixes from continued real-machine testing of v0.1.7:

### A failed mount could be silently reported as a success

If rclone failed to start the mount for a reason we hadn't specifically
coded for — for example, one connected account's upstream failing to
initialize — it logged a `CRITICAL:` error and exited almost immediately,
but CloudMerge's mount code only recognized two specific fatal-error
phrases. Everything else fell through to a 2.5-second timeout that assumed
success no matter what had actually happened, even though the process had
already died. This is likely what caused the "Windows cannot find
'C:\Users\...\CloudMerge'" error some of you hit — the folder never
finished connecting, but CloudMerge still believed it had.

Fixed by matching rclone's own `CRITICAL:` log level directly (rather than
guessing at specific phrases), and by double-checking that the mount
process is still actually alive before ever declaring success, instead of
just trusting that time passed without a recognized error.

### "Open Cloud Folder" could show a confusing Windows error

Every time an account is added or removed, CloudMerge briefly disconnects
and reconnects the folder to pick up the change (see v0.1.6 notes) — and
if "Open Cloud Folder" was clicked in that narrow window, or while a mount
had actually failed (see above), Windows would show its own generic
"Windows cannot find ... Make sure you typed the name correctly" dialog,
which reads like a typo rather than "not connected yet." CloudMerge now
checks first and shows a clearer message when the folder genuinely isn't
connected at that moment.

### Some accounts' friendly names could get stuck on the technical name

The friendly-name lookup only ever ran once per account (right when it was
added) plus once at startup. If that lookup failed for any reason — a
network blip, a momentarily rate-limited API call — that account's name
(and its folder) stayed on the technical `google_drive-xxxx` form for the
rest of that session, with no other chance to resolve until a full
restart. CloudMerge now retries any still-unlabeled account every few
minutes while it's running, so a one-off failure has a chance to fix
itself without you needing to restart.

### If you already have v0.1.0–v0.1.7 installed

Safe drop-in upgrade, no need to uninstall first, and no need to reconnect
any accounts.

See the [v0.1.7 release notes](https://github.com/TWELVESTONES/CM2026.v1/releases/tag/v0.1.7)
and [v0.1.0 release notes](https://github.com/TWELVESTONES/CM2026.v1/releases/tag/v0.1.0)
for prior fixes and the full feature list/known limitations (Windows only,
unsigned installer, personal-scale OAuth).
