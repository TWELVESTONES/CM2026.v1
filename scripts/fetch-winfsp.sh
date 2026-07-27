#!/usr/bin/env bash
# Downloads the official, unmodified WinFsp installer (GPLv3 w/ FLOSS
# exception, https://winfsp.dev) into resources/winfsp/. Run this once
# before your first `npm run dist:win` — CloudMerge's Windows installer
# bundles this file as-is and silently runs it during setup if WinFsp isn't
# already present (see installer.nsh and NOTICE.md for why bundling an
# unmodified copy is permitted under WinFsp's own license).
#
# The installer isn't committed to source control (same reasoning as
# rclone's binaries in fetch-rclone.sh — keep git history free of large
# binaries, always fetch the current official release at build time).
set -euo pipefail
cd "$(dirname "$0")/.."

WINFSP_VERSION="2.1"
WINFSP_MSI="winfsp-2.1.25156.msi"

mkdir -p resources/winfsp resources/licenses

echo "Fetching the official WinFsp ${WINFSP_VERSION} installer..."
curl -sL "https://github.com/winfsp/winfsp/releases/download/v${WINFSP_VERSION}/${WINFSP_MSI}" \
  -o "resources/winfsp/${WINFSP_MSI}"

echo "Fetching WinFsp's license text..."
curl -sL https://raw.githubusercontent.com/winfsp/winfsp/master/License.txt \
  -o resources/licenses/winfsp-LICENSE.txt

echo "Done. resources/winfsp/${WINFSP_MSI} is ready."
echo "If you bump WINFSP_VERSION/WINFSP_MSI here, also update the filename"
echo "referenced in installer.nsh's ExecWait line to match."
