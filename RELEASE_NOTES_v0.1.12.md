## CloudMerge v0.1.12 — a broken OneDrive account can no longer take down the whole folder

Thanks again for the continued testing — seeing the exact same crash after a full uninstall/reinstall pointed at something I'd missed: **CloudMerge's account settings live outside the app itself** (in a small config folder in your user profile), so uninstalling and reinstalling the app doesn't clear a broken account — it was still there the whole time, still crashing things.

### The bigger problem this uncovered

Whenever *any one* account's setup was incomplete (most commonly an old, already-broken OneDrive connection), CloudMerge's combined folder failed to connect *at all* — not just for that one account, but for every account, including Google Drive and Dropbox connections that were otherwise working perfectly. One bad account was taking the whole folder down with it, every time CloudMerge started.

### The fix

Two changes:

1. CloudMerge now checks each account's setup individually before building the combined folder, and simply leaves out any account that isn't fully set up — instead of failing the entire connection over one bad account. If this happens, you'll get a specific, one-time note naming which account needs attention, while everything else keeps working normally.
2. If adding a new OneDrive account ever fails partway through (the drive-selection step from v0.1.11 not completing), CloudMerge now automatically removes that half-finished attempt instead of leaving a broken entry sitting around to cause exactly this problem again later.

### What this means for you right now

Your existing broken OneDrive account should no longer prevent Google Drive/Dropbox from working. Worth trying again: remove the broken OneDrive account in Manage Accounts (if it's still listed) and add it fresh — between this and v0.1.11's fix, it has the best chance yet of connecting cleanly. If it still doesn't, please send the exact new message — each round of real testing has narrowed this down further, and that detail is what makes the next fix possible.

### If you already have v0.1.0–v0.1.11 installed

Safe drop-in upgrade, no need to uninstall first. Existing working accounts (Google Drive, Dropbox, already-working OneDrive accounts) are unaffected.

See the [v0.1.11 release notes](https://github.com/TWELVESTONES/CM2026.v1/releases/tag/v0.1.11), [v0.1.10 release notes](https://github.com/TWELVESTONES/CM2026.v1/releases/tag/v0.1.10), and [v0.1.0 release notes](https://github.com/TWELVESTONES/CM2026.v1/releases/tag/v0.1.0) for prior fixes and the full feature list/known limitations (Windows only, unsigned installer, personal-scale OAuth).
