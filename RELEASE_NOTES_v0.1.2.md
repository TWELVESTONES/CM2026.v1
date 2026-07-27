## CloudMerge v0.1.2 — startup reliability fix

If v0.1.1 (or v0.1.0) installed successfully but nothing seemed to happen —
no window, no tray icon, just a silent process — this release fixes it.

### What was actually going wrong

On first launch, CloudMerge checks in with the bundled rclone binary before
opening its window. If that check failed for any reason (most commonly:
antivirus software flagging/blocking `rclone.exe`, which is a known false
positive for several antivirus products since rclone is a powerful
file-transfer tool), the app had no error handling around that step. The
failure silently skipped opening the account manager window entirely,
leaving CloudMerge running invisibly in the background with no tray icon
and no window — nothing for you to click on, with no indication anything
was wrong.

Separately, double-clicking the desktop icon more than once (easy to do
when nothing visibly opens) spawned an entirely new, independent copy each
time instead of reopening the existing one — so a few double-clicks could
leave several invisible background copies running at once.

### What's fixed

- **The window always opens now**, even if rclone fails to start for any
  reason — and if it does fail, you'll get a clear error dialog explaining
  what happened (most likely: check whether your antivirus is blocking
  `resources/bin/rclone.exe` and add an exclusion if so) instead of silence.
- **Only one instance runs at a time.** Launching CloudMerge again while
  it's already running now just brings the existing window to the front,
  instead of creating a duplicate background process.
- Added a top-level safety net so any future unexpected error surfaces as a
  visible dialog rather than leaving the app running with nothing to show
  for it.

No other functional changes — same icon from v0.1.1, same account-linking
behavior, same MIT license.

### If you already have v0.1.0 or v0.1.1 installed

Uninstall the old version first (Windows Settings → Apps), then install
this one — a few invisible background copies of the old version may still
be running; check Task Manager for stray `CloudMerge.exe` processes and end
them if the uninstaller doesn't catch them.

See the [v0.1.0 release notes](https://github.com/TWELVESTONES/CM2026.v1/releases/tag/v0.1.0)
for the full feature list and remaining known limitations (Windows only,
unsigned installer, personal-scale OAuth).
