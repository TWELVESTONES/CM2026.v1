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

!macro customInstall
  ; $PROGRAMFILES64 / $PROGRAMFILES32 are NSIS built-ins that resolve
  ; correctly regardless of whether the installer itself is 32- or 64-bit,
  ; matching the two paths driver-check.js already checks at runtime.
  ${IfNot} ${FileExists} "$PROGRAMFILES64\WinFsp\*.*"
  ${AndIfNot} ${FileExists} "$PROGRAMFILES32\WinFsp\*.*"
    DetailPrint "WinFsp not found — installing it now (required to mount your cloud drives)..."
    ExecWait '"msiexec" /i "$INSTDIR\resources\winfsp\winfsp-2.1.25156.msi" /qn /norestart' $0
    DetailPrint "WinFsp installer finished with exit code $0"
  ${Else}
    DetailPrint "WinFsp is already installed — skipping."
  ${EndIf}
!macroend
