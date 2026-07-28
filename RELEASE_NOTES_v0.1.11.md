## CloudMerge v0.1.11 — the actual fix for OneDrive's "unable to get drive_id and drive_type" error

v0.1.10 attempted to fix this and didn't fully succeed — thank you for testing
it and reporting back that the exact same error came back, even on a
completely fresh install. This release replaces that attempt with a real
fix, verified against the specific gap the last one missed.

### Why v0.1.10 didn't actually fix it

Adding a OneDrive account walks through Microsoft's sign-in, but rclone (the
engine CloudMerge uses under the hood) also needs to know which specific
OneDrive drive to use — a question it normally asks interactively, right
after sign-in, by looking up your drives from Microsoft directly.

v0.1.10 pre-answered a different, earlier question (which *type* of
Microsoft connection to use), but left this drive question completely
unanswered. Looking at rclone's own source code, that question turns out to
have no shortcut at all — it's always asked, with no way to skip it by
pre-supplying a value up front. Since CloudMerge had no way to answer a
live interactive question, the account still ended up "added" in the list
but missing the information rclone needs to actually use it — the exact
same failure as before:

```
CRITICAL: Failed to create file system for "merged:": failed to create
upstream "onedrive-xxxx:": unable to get drive_id and drive_type
```

### The actual fix

CloudMerge now drives rclone's setup process step by step using rclone's
own documented protocol for doing this without a human typing into a
terminal, automatically answering each question as it comes up — including
the drive question, by picking your OneDrive drive automatically (personal
Microsoft accounts normally have exactly one). CloudMerge also now double
checks, right after setup, that the drive information was actually
recorded — if it wasn't, you'll get a clear message telling you to remove
and re-add the account, rather than a confusing crash later when the
folder tries to connect.

**Note:** I still wasn't able to test this specific fix against a live
Microsoft sign-in on my end (no way to do that safely without real
credentials on my side), so I need your real-world test again. If you still
have the broken OneDrive account, remove it in Manage Accounts and add it
again — that's the only way to fix an already-broken account, since the
drive information can only be filled in during setup. If it fails again,
please send me the exact new error text (a screenshot is perfect, like
before) — that detail is exactly what let me find and fix the real gap this
time.

### If you already have v0.1.0–v0.1.10 installed

Safe drop-in upgrade, no need to uninstall first. Existing working accounts
(Google Drive, Dropbox, already-working OneDrive accounts) are unaffected —
only OneDrive account setup itself changed.

See the [v0.1.10 release notes](https://github.com/TWELVESTONES/CM2026.v1/releases/tag/v0.1.10),
[v0.1.9 release notes](https://github.com/TWELVESTONES/CM2026.v1/releases/tag/v0.1.9),
and [v0.1.0 release notes](https://github.com/TWELVESTONES/CM2026.v1/releases/tag/v0.1.0)
for prior fixes and the full feature list/known limitations (Windows only,
unsigned installer, personal-scale OAuth).
