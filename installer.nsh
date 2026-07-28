; installer.nsh — custom NSIS install steps for CloudMerge.
;
; electron-builder inserts !insertmacro customInstall right after the app's
; own files (including extraResources) have been copied to $INSTDIR, so the
; bundled WinFsp installer at $INSTDIR\resources\winfsp\ is guaranteed to
; already exist by the time this macro runs.
;
; Bundling this unmodified installer is permitted under WinFsp's FLOSS
; exception (CloudMerge is MIT-licensed and carries the required
; attribution in its About screen) — see NOTICE.md for the full reasoning.
; This only covers Windows/WinFsp: macFUSE's license is stricter and isn't
; bundled (see driver-check.js and NOTICE.md).
;
; v0.1.5 fix: CloudMerge's own installer is deliberately a normal per-user
; install (perMachine is not set, so it never prompts for admin rights just
; to install the app itself). But WinFsp installs a kernel-mode driver,
; which Windows will only allow an *elevated* process to do. Plain
; ExecWait'ing msiexec here (as v0.1.3/v0.1.4 did) silently failed with an
; insufficient-privileges error every time — /qn suppresses all UI, so
; nothing was ever shown, and the app just fell back to the old
; download-page prompt at first launch. ExecShellWait's "runas" verb fixes
; this by triggering a single, real Windows UAC consent prompt for just
; this one step (the MSI's own UI stays suppressed via /qn) — the same
; pattern used by most bundled prerequisite installers (e.g. VC++
; redistributable bootstrappers). This can't be avoided or faked: Windows
; requires genuine elevation to install a driver, no installer can bypass
; that, and no installer should try to.

!macro customInstall
  ; $PROGRAMFILES64 / $PROGRAMFILES32 are NSIS built-ins that resolve
  ; correctly regardless of whether the installer itself is 32- or 64-bit,
  ; matching the two paths driver-check.js already checks at runtime.
  ${IfNot} ${FileExists} "$PROGRAMFILES64\WinFsp\*.*"
  ${AndIfNot} ${FileExists} "$PROGRAMFILES32\WinFsp\*.*"
    DetailPrint "WinFsp not found — installing it now. Windows will ask you to approve this step (it installs a system driver, which always requires that approval)."
    ExecShellWait "runas" "msiexec.exe" '/i "$INSTDIR\resources\winfsp\winfsp-2.1.25156.msi" /qn /norestart'
    Pop $0
    DetailPrint "WinFsp installer finished with exit code $0"
  ${Else}
    DetailPrint "WinFsp is already installed — skipping."
  ${EndIf}
!macroend
