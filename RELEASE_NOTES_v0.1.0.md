# CloudMerge v0.1.0 — first release

CloudMerge unifies Google Drive, OneDrive, Dropbox, WD My Cloud / My Cloud
Home (or any other NAS over SMB), and anything else rclone supports into
**one local folder** on your own machine — no server, no relay, nothing
routed through CloudMerge-operated infrastructure, because none exists.

## What's in this release

- Electron tray app for Windows, wrapping the real [rclone](https://rclone.org)
  binary (MIT licensed) — CloudMerge never reimplements any provider's sync
  protocol.
- Add/remove accounts for Google Drive, OneDrive, and Dropbox via rclone's
  normal browser-based OAuth sign-in.
- Connect WD My Cloud, My Cloud Home, or any generic NAS over SMB (device
  address, share name, username, password — password stored obscured, never
  plaintext).
- All connected accounts merge into one live folder (`~/CloudMerge`) via
  rclone's `combine` backend — add an account and it shows up as a new
  subfolder immediately.
- Free and open source under the MIT License. This is a deliberate choice:
  it's what lets CloudMerge legitimately use WinFsp's (the Windows
  filesystem driver rclone's mount depends on) free-use exception — see
  `NOTICE.md` for details, and the in-app "About & open-source notices"
  dialog for the required attribution text.

## Known limitations in this release

- **Windows only.** A Mac build needs macOS/macOS CI to produce a signed
  `.dmg` — not included here. See `README.md` for details, and note that
  macFUSE's bundling terms need written confirmation from its maintainer
  before a Mac build ships.
- **Unsigned installer.** This build isn't code-signed yet, so Windows
  SmartScreen may warn on first run ("Windows protected your PC" → "More
  info" → "Run anyway"). Code signing is a real next step for wider
  distribution, not yet done.
- **Personal-scale OAuth.** Account linking uses rclone's own registered
  OAuth client IDs — this works today with zero setup, but real
  volume/public distribution would need registering separate OAuth apps
  with each provider (Google in particular requires an app verification
  review for Drive access at scale).
- WinFsp must be installed separately (CloudMerge checks for it and prompts
  with a link if it's missing) — it isn't bundled, per its own licensing
  terms.

## Install

Download `CloudMerge Setup 0.1.0.exe` below, run it, and install WinFsp
first if prompted (one-time, from https://winfsp.dev). Full source and build
instructions are in this repository's `README.md`.
