# Downloads the official rclone binaries (MIT licensed, https://rclone.org)
# for each shipping platform into resources/bin/. Run this once before your
# first `npm run dist:win` / `npm run dist:mac`.
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

New-Item -ItemType Directory -Force -Path resources/bin/win, resources/bin/mac, resources/licenses | Out-Null
$tmp = New-Item -ItemType Directory -Force -Path ([System.IO.Path]::GetTempPath() + [System.Guid]::NewGuid())

Write-Host "Fetching rclone for Windows..."
Invoke-WebRequest -Uri "https://downloads.rclone.org/rclone-current-windows-amd64.zip" -OutFile "$tmp/win.zip"
Expand-Archive "$tmp/win.zip" -DestinationPath "$tmp/win"
Copy-Item "$tmp/win/rclone-*-windows-amd64/rclone.exe" resources/bin/win/rclone.exe

Write-Host "Fetching rclone for macOS..."
Invoke-WebRequest -Uri "https://downloads.rclone.org/rclone-current-osx-amd64.zip" -OutFile "$tmp/mac.zip"
Expand-Archive "$tmp/mac.zip" -DestinationPath "$tmp/mac"
Copy-Item "$tmp/mac/rclone-*-osx-amd64/rclone" resources/bin/mac/rclone-mac

Write-Host "Fetching rclone's MIT license text..."
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/rclone/rclone/master/COPYING" -OutFile resources/licenses/rclone-LICENSE.txt

Remove-Item -Recurse -Force $tmp
Write-Host "Done. resources/bin/win/rclone.exe and resources/bin/mac/rclone-mac are ready."
