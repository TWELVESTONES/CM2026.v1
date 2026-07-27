#!/usr/bin/env bash
# Downloads the official rclone binaries (MIT licensed, https://rclone.org)
# for each shipping platform into resources/bin/. Run this once before your
# first `npm run dist:win` / `npm run dist:mac` — the binaries aren't
# committed to source control (they're ~80-90MB each).
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p resources/bin/win resources/bin/mac
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Fetching rclone for Windows..."
curl -sL https://downloads.rclone.org/rclone-current-windows-amd64.zip -o "$tmp/win.zip"
unzip -o -q "$tmp/win.zip" -d "$tmp/win"
cp "$tmp"/win/rclone-*-windows-amd64/rclone.exe resources/bin/win/rclone.exe

echo "Fetching rclone for macOS..."
curl -sL https://downloads.rclone.org/rclone-current-osx-amd64.zip -o "$tmp/mac.zip"
unzip -o -q "$tmp/mac.zip" -d "$tmp/mac"
cp "$tmp"/mac/rclone-*-osx-amd64/rclone resources/bin/mac/rclone-mac
chmod +x resources/bin/mac/rclone-mac

echo "Fetching rclone's MIT license text..."
mkdir -p resources/licenses
curl -sL https://raw.githubusercontent.com/rclone/rclone/master/COPYING -o resources/licenses/rclone-LICENSE.txt

echo "Done. resources/bin/win/rclone.exe and resources/bin/mac/rclone-mac are ready."
echo "(For local dev/testing on Linux only — not shipped — also grab a linux build:"
echo "  curl -sL https://downloads.rclone.org/rclone-current-linux-amd64.zip -o /tmp/rc.zip"
echo "  unzip -o -q /tmp/rc.zip -d /tmp/rc && cp /tmp/rc/*/rclone resources/bin/rclone-linux && chmod +x resources/bin/rclone-linux)"
