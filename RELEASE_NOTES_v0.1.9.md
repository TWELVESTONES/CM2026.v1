## CloudMerge v0.1.9 — fix: "Connected" could show even when the folder wasn't actually reachable

One more fix from continued real-machine testing of v0.1.8.

### The app could say "Connected" while Windows still couldn't find the folder

v0.1.8 fixed one way a failed mount could be silently reported as a success
(a rclone `CRITICAL:` crash going undetected). But there's a second way the
same symptom could happen: the rclone process can stay running just fine
without WinFsp ever actually attaching the folder — for example, if
`C:\Users\...\CloudMerge` already existed with leftover files in it (from
an older CloudMerge version, or a previous failed connection attempt),
which blocks Windows from connecting a folder at a path that already
exists and isn't empty. Since the process itself never crashed or logged
anything CRITICAL, CloudMerge still reported "Connected" — but Explorer's
own "Windows cannot find 'C:\Users\...\CloudMerge'" error still appeared
when actually trying to open it.

Fixed by no longer treating "the rclone process is still running" as proof
the folder is usable. CloudMerge now confirms the folder is genuinely
showing your connected accounts before ever reporting success, and will
show a clear, specific error — including a direct hint to remove a stale
leftover `CloudMerge` folder, when that looks like the cause — instead of
silently declaring victory. The same check now also guards "Open Cloud
Folder," so it can no longer trigger Windows' own confusing error dialog
even in this scenario.

### If you already have v0.1.0–v0.1.8 installed

Safe drop-in upgrade, no need to uninstall first, and no need to reconnect
any accounts. If your CloudMerge folder has been failing to connect, this
version will now tell you clearly if a leftover folder from an older
version is the reason, and what to do about it.

See the [v0.1.8 release notes](https://github.com/TWELVESTONES/CM2026.v1/releases/tag/v0.1.8)
and [v0.1.0 release notes](https://github.com/TWELVESTONES/CM2026.v1/releases/tag/v0.1.0)
for prior fixes and the full feature list/known limitations (Windows only,
unsigned installer, personal-scale OAuth).
