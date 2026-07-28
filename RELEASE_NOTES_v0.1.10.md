## CloudMerge v0.1.10 — fix: OneDrive accounts failing with "unable to get drive_id and drive_type"

Thanks to v0.1.9's more accurate error reporting, a real, previously-hidden
bug in OneDrive account setup surfaced clearly for the first time — this
release fixes it.

### What was happening

Adding a OneDrive account walks through Microsoft's sign-in, but rclone
(the engine CloudMerge uses under the hood) also needs to know which
specific OneDrive drive to use — normally an interactive question asked
right after sign-in. CloudMerge's account-adding flow had no way to answer
that question, since it never puts up a prompt for it. Previously this
could leave a OneDrive account looking "added" in the list, but without the
information rclone actually needs to use it — invisible until the folder
tried to mount, at which point it failed with:

```
CRITICAL: Failed to create file system for "merged:": failed to create
upstream "onedrive-xxxx:": unable to get drive_id and drive_type
```

(You'd only ever see this clearly as of v0.1.9 — before that, this exact
failure could be swallowed the same way other silent mount failures were.)

### The fix

CloudMerge now answers that setup question itself before rclone ever needs
to ask it, using the same information rclone would use for the common case
of a personal Microsoft account (matching CloudMerge's personal-scale
scope) — so a fresh OneDrive connection resolves the drive automatically
instead of leaving it unset.

**Note:** I wasn't able to fully test this specific fix against a live
Microsoft OneDrive sign-in on my end, so this one especially needs a real
check from you. If you have a OneDrive account that's currently showing
this error, remove it from Manage Accounts and add it again — that's the
only way to fix an already-broken account, since the drive information can
only be filled in during setup, not repaired after the fact.

### If you already have v0.1.0–v0.1.9 installed

Safe drop-in upgrade, no need to uninstall first. Existing working accounts
(Google Drive, Dropbox, already-working OneDrive accounts) are unaffected —
only new OneDrive connections go through the fixed setup path.

See the [v0.1.9 release notes](https://github.com/TWELVESTONES/CM2026.v1/releases/tag/v0.1.9)
and [v0.1.0 release notes](https://github.com/TWELVESTONES/CM2026.v1/releases/tag/v0.1.0)
for prior fixes and the full feature list/known limitations (Windows only,
unsigned installer, personal-scale OAuth).
