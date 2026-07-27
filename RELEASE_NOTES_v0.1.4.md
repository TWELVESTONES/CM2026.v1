## CloudMerge v0.1.4 — fix: Remove account button did nothing

If you clicked "Remove" next to a connected account and it just stayed in
the list with no error, this release fixes it.

### What was actually going wrong

The account list UI called rclone's `config delete` with the remote's name
plus a trailing colon (e.g. `google_drive-ms3r4yph:`), copying the format
used elsewhere for referring to a remote's files. But `config delete`
operates on the config file's section name, which never has a colon — and
rclone doesn't treat a colon-suffixed name as an error, it just silently
exits successfully having deleted nothing. That's what made Remove look
like it was simply broken: no error, just no effect.

### What's fixed

- Removing an account now actually removes it.
- As a safety net, CloudMerge now double-checks after every removal that
  the account is really gone before reporting success, and shows a real
  error if it somehow isn't — so a silent no-op like this can't happen
  again without at least surfacing an error.

No other changes. If you already have v0.1.0–v0.1.3 installed, this is a
safe drop-in upgrade — no need to uninstall first, and no need to
reconnect any working accounts.

See the [v0.1.3 release notes](https://github.com/TWELVESTONES/CM2026.v1/releases/tag/v0.1.3)
and [v0.1.0 release notes](https://github.com/TWELVESTONES/CM2026.v1/releases/tag/v0.1.0)
for prior fixes and the full feature list/known limitations (Windows only,
unsigned installer, personal-scale OAuth).
