## CloudMerge v0.1.3 — WinFsp auto-install + friendly account names

Two usability improvements, no breaking changes.

### WinFsp is now installed for you automatically

Previously, CloudMerge needed WinFsp (the Windows driver that lets it mount
your combined cloud accounts as a real folder) to already be installed, and
would just point you at a download page if it wasn't. Starting with this
release, the Windows installer bundles the official, unmodified WinFsp
installer and silently installs it during setup — only if it isn't already
on your machine. If you already have WinFsp (from CloudMerge or anything
else that uses it), this is a no-op; nothing changes for you.

This is possible because WinFsp's own license includes a free exception
for open-source software that meets a few conditions, which CloudMerge
already satisfies (see `NOTICE.md` for the full reasoning and attribution).

### Cloud accounts now show their real name

Connected accounts used to show up in the list as their internal technical
ID, e.g. "Google Drive — google_drive-ms3r4yph". Now, right after you
connect an account, CloudMerge asks the provider who it belongs to and
shows that instead — e.g. "Google Drive — jamesfw@gmail.com". This also
runs once in the background for accounts you already had connected from an
earlier version, so you don't need to reconnect anything to get the
friendlier name.

This lookup is best-effort: if it can't complete for any reason (you're
offline, a provider's API changes shape, etc.), the account still works
exactly as before — it just falls back to showing the technical name.

### If you already have v0.1.0–v0.1.2 installed

This is a safe drop-in upgrade — no need to uninstall first. Your connected
accounts, mount folder, and settings all carry over untouched.

See the [v0.1.2 release notes](https://github.com/TWELVESTONES/CM2026.v1/releases/tag/v0.1.2)
and [v0.1.0 release notes](https://github.com/TWELVESTONES/CM2026.v1/releases/tag/v0.1.0)
for prior fixes and the full feature list/known limitations (Windows only,
unsigned installer, personal-scale OAuth).
