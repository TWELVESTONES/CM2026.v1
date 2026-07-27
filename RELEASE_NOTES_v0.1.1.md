## CloudMerge v0.1.1

Small but overdue fix: **v0.1.0 shipped without a real app icon.** The code
referenced a tray icon file that was never actually created, so the tray
icon showed up blank/generic, and the installer/app used Electron's default
placeholder icon — not anything CloudMerge-specific.

This release adds a real, custom-designed icon (a simple folder-and-cloud
mark) and wires it in everywhere:

- Windows installer and app icon (visible in File Explorer, the Start Menu,
  and the taskbar)
- System tray icon
- The account manager window now shows the logo next to the title

No functional changes otherwise — same account-linking behavior, same
WD Cloud/NAS support, same MIT license. If you already installed v0.1.0,
this is a drop-in upgrade: uninstall the old version first (or just install
over it), then run the new installer.

See the [v0.1.0 release notes](https://github.com/TWELVESTONES/CM2026.v1/releases/tag/v0.1.0)
for the full feature list and known limitations, which still apply here
(Windows only, unsigned installer, personal-scale OAuth).
