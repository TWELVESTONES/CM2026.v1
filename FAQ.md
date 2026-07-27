# CloudMerge — Frequently Asked Questions

## What is CloudMerge?

CloudMerge merges Google Drive, OneDrive, Dropbox, WD My Cloud / My Cloud
Home (or any other NAS over SMB), and anything else the
[rclone](https://rclone.org) engine supports into **one folder** on your own
computer. Add an account and it shows up as a subfolder — no separate app
window per service, no juggling multiple sign-ins across different programs.

## Do I need to send both the .exe and the source .zip to a friend?

Just the `.exe`. That's the finished, installable program — it already has
everything it needs bundled inside. The source `.zip` is only useful to
someone who wants to read or modify the code themselves; a normal user has
no use for it.

## How many accounts can I connect? Is there a limit per service?

No limit. You can connect any number of Google Drive, OneDrive, Dropbox, or
WD Cloud/NAS accounts, in any mix — 1, 7, 20, doesn't matter. Nothing in the
app enforces a cap.

This is the actual reason CloudMerge exists: the official Google Drive,
OneDrive, and Dropbox desktop apps each cap how many accounts you can be
signed into at once. CloudMerge doesn't have that restriction because every
account you add becomes its own independent connection under the hood, and
they're all merged into the same local folder as separate subfolders.

A couple of real (not artificial) things to keep in mind with a lot of
accounts connected:
- You still sign in to each one individually the first time (OAuth in your
  browser for Google/OneDrive/Dropbox, or address/share/username/password
  for a NAS).
- More accounts means more subfolders to scroll through — nothing breaks,
  it's just more to look at.
- Extremely heavy simultaneous use of many Google accounts could in theory
  bump into Google's own API rate limits — that's throttling on Google's
  side, not something CloudMerge imposes.

## Is it really free?

Yes. CloudMerge is free and open source under the MIT License — no
subscription, no paid tier, no account required to use it. The full source
is public: https://github.com/TWELVESTONES/CM2026.v1

## Does my data or my passwords go through a CloudMerge server?

No. There is no CloudMerge server, relay, or proxy — none exists. The app
runs entirely on your own machine: it spawns the real `rclone` program
locally, and your files move directly between your computer and each
provider's own servers (Google's, Microsoft's, Dropbox's). Your OAuth
tokens are stored in a local config file on your own disk
(`~/.cloudmerge/rclone.conf`) and are never sent anywhere else. CloudMerge
never sees or stores your actual password for Google/OneDrive/Dropbox — you
sign in through their own browser-based login screen, and only the
resulting access token comes back to the app.

For a NAS/WD Cloud connection, the password is stored "obscured" (encoded)
in that same local config file, never in plain text — but note obscured is
not the same as strongly encrypted, so treat that config file with the same
care you'd give any file with saved credentials.

## What do I need to install it?

1. Download and run `CloudMerge Setup 0.1.0.exe`.
2. Windows SmartScreen will very likely warn you first
   ("Windows protected your PC") because the installer isn't code-signed
   yet. Click **More info → Run anyway** to proceed. This is expected and
   not a sign anything is wrong — code signing is a planned improvement,
   not yet done.
3. The first time CloudMerge tries to mount your merged folder, it checks
   for **WinFsp**, the Windows driver that makes the virtual folder
   possible. If it's missing, CloudMerge prompts you with a link to
   download it from winfsp.dev — a normal one-time install, separate from
   CloudMerge itself.

## Does it work on Mac?

Not yet in a distributable form. The Mac build needs to be compiled and
signed on an actual Mac (or macOS CI), which hasn't been done. There's also
an open licensing question around macFUSE (the Mac equivalent of WinFsp)
that needs written confirmation from its maintainer before a Mac build
ships. Windows is the only platform with a real installer right now.

## Where do I download it / get updates?

From the GitHub Releases page:
https://github.com/TWELVESTONES/CM2026.v1/releases

Future versions will be posted there as new releases, each with its own
installer attached.

## How do I add or remove an account?

Open CloudMerge (tray icon → Manage Accounts). Click the button for the
service you want (Google Drive / OneDrive / Dropbox opens a browser
sign-in; WD Cloud/NAS shows a small form for the device address, share
name, username, and password). To remove one, click "Remove" next to it in
the account list — this disconnects it and its subfolder disappears from
the merged folder, but doesn't touch any files on the actual cloud account.

## Is the merged folder a live view or a synced copy?

It's a live, direct window into your accounts, not a background sync tool
copying files to your hard drive. Opening, saving, or dragging a file into
the CloudMerge folder reads or writes directly to that account's own
servers. There can be a brief delay for larger files simply because of your
own upload/download speed, the same as using any cloud provider's website.

## Something isn't working — where do I start?

- **App won't open / SmartScreen blocked it entirely:** make sure you
  clicked "Run anyway," not "Don't run."
- **Folder isn't showing up after adding an account:** check whether
  WinFsp is installed (CloudMerge should prompt you if not).
- **A NAS/WD Cloud account won't connect:** double-check the device address
  and share name — these are visible in WD Discovery or your router's
  connected-devices list.
- **Anything else:** open an issue on the GitHub repo —
  https://github.com/TWELVESTONES/CM2026.v1/issues

## Is this an official Google/Microsoft/Dropbox/WD product?

No. CloudMerge is an independent, open-source project. It uses each
provider's normal public sign-in process, but isn't made, endorsed, or
supported by Google, Microsoft, Dropbox, or Western Digital.
