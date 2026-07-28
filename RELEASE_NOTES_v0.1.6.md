## CloudMerge v0.1.6 — fix: connected accounts weren't actually mounting (empty folder, missing names, add errors)

If you connected accounts and the CloudMerge folder stayed empty, friendly
account names never appeared, and adding Dropbox/OneDrive threw an error —
this release fixes the underlying bug all three of those traced back to.

### What was actually going wrong

CloudMerge mounts your accounts by asking rclone to present them as one
combined folder. On Windows, the code that sets this up was passing two
mutually incompatible options to rclone: it told rclone to mount as a
**network drive** (`--network-mode`), while also asking it to mount onto a
plain **folder path** (`~/CloudMerge`). rclone's own documentation is
explicit that these two don't mix — network-drive mode can only mount to a
drive letter, never a folder. On top of that, CloudMerge was
pre-creating that folder before handing it to rclone, which is backwards
for Windows: a normal folder-path mount there requires the target to
**not** already exist yet (rclone/WinFsp creates it). Every real mount
attempt on Windows was guaranteed to fail because of this, on every
version up through v0.1.5 — it just never surfaced, because until v0.1.5,
WinFsp usually wasn't installed yet either (see the v0.1.5 notes), so this
particular code path had never really been exercised on a real machine
until now.

That single mount failure cascaded into everything else you saw:

- **Empty folder** — directly, since the mount never actually succeeded.
- **Missing friendly names** — the step that looks up and stores a
  friendly name for a newly-connected account ran *after* the mount step
  in the code, so when the mount step failed, it aborted before that
  naming step ever got a chance to run.
- **Errors adding Dropbox/OneDrive** — the same mount attempt (and
  failure) happens every time any account is added, regardless of
  provider, so it surfaced as a generic "could not add account" error for
  those too, even though the account itself was actually connected fine.

Separately, we also found and fixed a second, related bug: rclone's
"combine" backend (the thing that merges all your accounts into one view)
only reads the list of connected accounts once, when the mount first
starts — it doesn't notice new accounts added afterward without being
restarted. So even once the mount-failure bug above is fixed, only the
*first* account you ever connected would have shown up; later ones would
silently never appear until you restarted CloudMerge. This is now fixed
too: adding or removing an account refreshes the mount automatically.

### What's fixed

- Windows folder mounting no longer uses the incompatible network-drive
  flag, and no longer pre-creates the folder — matching what rclone
  actually needs for a folder-path mount to succeed.
- Adding or removing an account now refreshes the connected folder
  immediately, so every account you connect actually shows up (not just
  the first).
- A mount hiccup can no longer silently block the friendly-name lookup,
  and can no longer make a successfully-added account look like it failed
  to add.
- If mounting the folder does fail for some other reason, CloudMerge now
  tells you about it in a real dialog, instead of failing silently with
  no explanation (this used to be swallowed entirely, despite a code
  comment claiming otherwise).

### If you already have v0.1.0–v0.1.5 installed

Safe drop-in upgrade, no need to uninstall first, and no need to
reconnect any accounts — they're already in your rclone config, they just
need CloudMerge to actually mount them correctly, which this release does.
After upgrading, reopen CloudMerge (or use "Manage Accounts…" from the
tray icon) and give it a few seconds to reconnect the folder.

See the [v0.1.5 release notes](https://github.com/TWELVESTONES/CM2026.v1/releases/tag/v0.1.5)
and [v0.1.0 release notes](https://github.com/TWELVESTONES/CM2026.v1/releases/tag/v0.1.0)
for prior fixes and the full feature list/known limitations (Windows only,
unsigned installer, personal-scale OAuth).
