# CloudMerge

Free and open-source (MIT licensed). Unifies Google Drive, OneDrive, Dropbox,
WD My Cloud / My Cloud Home (or any other NAS over SMB), and anything else
rclone supports — S3, Box, pCloud, WebDAV, 70+ backends — into **one local
folder**, odrive-style.

**Everything runs on your own machine.** There is no CloudMerge server, no
relay, no proxy. The app spawns the real rclone binary locally, mounts your
combined accounts to a folder on your own disk via WinFsp/macFUSE, and your
files flow directly between your computer and Google/Microsoft/Dropbox's own
servers. Your OAuth tokens live in a local config file
(`~/.cloudmerge/rclone.conf`) on your machine — nothing you connect here is
ever sent to, or stored by, any CloudMerge-operated infrastructure, because
none exists.

## How it works

- **Engine:** the real [rclone](https://rclone.org) binary (MIT licensed),
  bundled per-platform under `resources/bin/`. CloudMerge never reimplements
  Google/Microsoft/Dropbox's sync protocols — it shells out to rclone for
  every account connection and every mount.
- **Unification:** rclone's `combine` backend merges every connected account
  into one virtual remote, mounted to `~/CloudMerge` via `rclone mount`. Add
  an account → it appears as a new subfolder, live, without restarting
  anything.
- **UI:** an Electron tray app, running locally. Click the tray icon or
  "Manage Accounts" to add/remove accounts. Google Drive/OneDrive/Dropbox
  buttons drive rclone's OAuth flow, opening your browser for a normal
  sign-in — CloudMerge never sees or stores your password, only the
  resulting local access token.
- **WD Cloud / NAS (SMB):** WD My Cloud, My Cloud Home, and generic NAS
  devices don't speak OAuth — they're reached over your local network via
  SMB, the same protocol as Windows file sharing. That button shows a small
  form instead (device address, share name, username, password) and
  connects directly; the password is stored obscured in rclone's config
  file (`rclone config create ... --obscure`), never in plaintext.

## Project layout

```
src/main/index.js         Electron main process, tray, IPC handlers
src/main/rclone.js         rclone subprocess wrapper (config/remotes)
src/main/mount.js           combine-remote + rclone mount lifecycle
src/main/driver-check.js  checks for WinFsp/macFUSE before mounting
src/renderer/              account-manager window + About/notices dialog
resources/bin/win/         rclone.exe             (bundled in Windows build, fetched — not committed)
resources/bin/mac/         rclone-mac              (bundled in Mac build, fetched — not committed)
resources/bin/rclone-linux   dev/testing only — NOT shipped in any installer
resources/licenses/         third-party license texts (see NOTICE.md)
LICENSE                    CloudMerge's own MIT license
NOTICE.md                  Required third-party attributions (rclone, WinFsp, macFUSE)
```

## Building it yourself

```
scripts/fetch-rclone.sh      # or fetch-rclone.ps1 on Windows — downloads the real rclone binaries
scripts/fetch-winfsp.sh      # downloads the official WinFsp installer, bundled into the Windows build
npm install
npm run start                # run unpacked, for development
npm run dist:win              # → dist/CloudMerge Setup <version>.exe  (built & tested — works from Linux via wine)
npm run dist:mac               # → dist/CloudMerge-<version>.dmg        (needs a real Mac or macOS CI runner — see below)
```

Both `npm run dist:*` commands were actually run against this codebase while
building it: the Windows NSIS installer builds cleanly (~96MB, confirmed
containing the real `rclone.exe` and license files). The Mac `dmg` target
needs macOS-only tooling (`dmg-license`, code-signing) that doesn't exist on
Linux; an **unsigned** `.app` zip could still be produced cross-platform for
quick testing (`electron-builder --mac --x64 -c.mac.target=zip
-c.mac.identity=null`) — useful for a smoke test, not for real distribution.

## License

CloudMerge itself is MIT licensed — see `LICENSE`. That was a deliberate
choice, not just a formality: WinFsp's free-use exception (see NOTICE.md)
specifically requires the *integrating* software to be distributed under an
approved FLOSS license, not merely free-of-charge. MIT satisfies that.

To fully claim that exception you also need to keep two things true going
forward, both already done in this codebase:

1. **The attribution notice must appear in the UI, not just in docs.** The
   app's "About & open-source notices" dialog (Manage Accounts → footer)
   shows the required "WinFsp - Windows File System Proxy, Copyright (C)
   Bill Zissimopoulos" notice with a link to its repo — keep that dialog
   intact in any fork.
2. **Don't mix in proprietary components.** Everything else this app
   depends on (Electron, auto-launch, rclone) is itself permissively
   licensed (MIT) — see NOTICE.md for the full list.

**macFUSE is the one open item.** Its license restricts bundling "with
commercial software" without permission, but never actually defines
"commercial" — it's not obviously tied to license type the way WinFsp's is.
Being open source strengthens your case, but doesn't guarantee it. **Email
Benjamin Fleischer (fleiben@gmail.com) and get written confirmation** that
an MIT-licensed, open-source app qualifies before you ship a build that
bundles macFUSE. Don't assume.

## Other real steps before wide distribution

These aren't code problems — they're genuine next steps, listed so they
don't get lost:

- **Code signing.** An unsigned Windows installer triggers SmartScreen
  warnings. Mac distribution beyond your own machine needs an Apple
  Developer Program membership ($99/yr) and notarization — which also means
  the `.dmg` build needs to actually run on macOS or macOS CI, not just a
  missing npm package.
- **OAuth at scale.** rclone's own registered client IDs make account
  linking work today with zero setup — fine for personal use and small-scale
  testing. Real volume means registering your own OAuth apps with each
  provider, and Google in particular requires a verification review (with a
  third-party security assessment) for public apps requesting Drive access —
  budget real weeks for that, not days.
- **If you ever add a paid tier** (hosting, support, a pro version) on top
  of this open-core base: a EULA and a real privacy policy, reviewed by
  someone qualified — this app touches people's cloud credentials and files,
  so that policy isn't boilerplate.

## Contributing / repository

Source: https://github.com/TWELVESTONES/CM2026.v1

Compiled installers are attached to each
[GitHub Release](https://github.com/TWELVESTONES/CM2026.v1/releases) — that's
the recommended way for non-developers to get the app, since it doesn't
require building from source.
