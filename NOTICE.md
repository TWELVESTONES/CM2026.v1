# Third-party notices

CloudMerge's own code is MIT licensed (see `LICENSE`). It depends on the
following third-party software, each under its own terms:

## rclone

CloudMerge shells out to the real [rclone](https://rclone.org) binary for
every cloud-account connection and mount operation. rclone is Copyright (C)
2012 Nick Craig-Wood, licensed under the MIT License. Full text bundled at
`resources/licenses/rclone-LICENSE.txt` and included in every build's
`resources/licenses/` folder.

## WinFsp (Windows mounting)

**WinFsp - Windows File System Proxy, Copyright (C) Bill Zissimopoulos.**
Repository: https://github.com/winfsp/winfsp

CloudMerge relies on WinFsp to present the merged cloud-drive folder as a
real mount point on Windows. WinFsp is GPLv3 by default, with a free
exception for FLOSS software that satisfies the Free Software Definition or
Open Source Definition, doesn't mix with proprietary software, and includes
this exact notice in its UI and documentation — CloudMerge does both (see
the in-app "About" screen and this file). Full license text bundled at
`resources/licenses/winfsp-LICENSE.txt`. Commercial licensing (if you ever
fork this into a closed-source product) is available directly from Bill
Zissimopoulos — see that file for contact details.

As of v0.1.3, the Windows installer also bundles the official, unmodified
WinFsp installer (`winfsp-2.1.25156.msi`, downloaded as-is from WinFsp's own
GitHub releases) and silently runs it during setup if WinFsp isn't already
present on the machine. This is covered by the same FLOSS exception quoted
above — specifically its second grant, "permission to distribute unmodified
binary releases of the WinFsp installer (as released by the WinFsp
project)." If you fork this project, keep the bundled `.msi` unmodified and
keep this notice + the About screen attribution intact, or drop the
bundling and fall back to the download-page prompt in `driver-check.js`.

## macFUSE (Mac mounting)

**macFUSE, Copyright (C) 2011-2026 Benjamin Fleischer** (and prior
contributors — see `resources/licenses/` once you've pulled the current
terms). Repository/homepage: https://osxfuse.github.io/

macFUSE's own license restricts "redistributions in binary form, bundled
with commercial software" without prior written permission, but does not
clearly define whether "commercial" turns on price or on open-source status
the way WinFsp's does. **Before distributing any build that bundles
macFUSE, contact Benjamin Fleischer (fleiben@gmail.com) directly and get
written confirmation** that an open-source, MIT-licensed app like this one
qualifies — don't assume based on this project's own open-source status
alone.

## Electron / auto-launch

Electron is MIT licensed (Copyright OpenJS Foundation and contributors). The
`auto-launch` npm package is MIT licensed. Both are standard permissive
dependencies with no bundling restrictions.

---

If you fork or redistribute CloudMerge, keep this file and `LICENSE` intact,
and keep the in-app About screen's attributions visible — that's what
satisfies WinFsp's FLOSS exception condition #2 (notice + repo link in the
UI and docs), not just this file existing somewhere in the repo.
