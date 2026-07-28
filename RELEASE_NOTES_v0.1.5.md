## CloudMerge v0.1.5 — fix: bundled WinFsp installer wasn't actually installing

v0.1.3 was supposed to make the Windows installer install WinFsp for you
automatically if it wasn't already present. If you installed v0.1.3 or
v0.1.4 and still got the old "WinFsp required — open download page" prompt
the first time you ran CloudMerge, this is why, and it's now fixed.

### What was actually going wrong

WinFsp installs a Windows kernel-mode driver, which Windows will only let
an *elevated* (administrator) process do. CloudMerge's own installer is
deliberately a normal per-user install — it doesn't ask for admin rights
just to install the app itself, since it doesn't need them. But that meant
when it silently tried to run WinFsp's installer in the background, Windows
rejected it for insufficient privileges, and because that step was fully
silent by design (no UI, so it wouldn't interrupt setup), the failure was
completely invisible. CloudMerge's install finished looking normal, WinFsp
was never actually installed, and the old fallback prompt did exactly what
it was built to do: catch this and point you at the official installer.
The fallback worked as intended — the automatic step just never had a real
chance to succeed.

### What's fixed

Installing WinFsp now explicitly requests the elevation it actually needs:
during setup, if WinFsp isn't already on your machine, you'll see one real
Windows admin/UAC prompt specifically for that step. Approve it, and WinFsp
installs silently from there — no separate download, no visiting a website.
This one prompt is unavoidable (and shouldn't be avoidable): installing any
driver requires it, on any Windows machine, from any installer.

If you don't already have WinFsp, expect to see that one admin prompt
during this version's install — that's correct behavior, not a bug.

### If you already have v0.1.0–v0.1.4 installed

Safe drop-in upgrade, no need to uninstall first. If WinFsp already got
installed via the manual download-page prompt on your machine, this
upgrade is a no-op for that part — nothing to redo.

See the [v0.1.4 release notes](https://github.com/TWELVESTONES/CM2026.v1/releases/tag/v0.1.4)
and [v0.1.0 release notes](https://github.com/TWELVESTONES/CM2026.v1/releases/tag/v0.1.0)
for prior fixes and the full feature list/known limitations (Windows only,
unsigned installer, personal-scale OAuth).
