'use strict';

/**
 * account-identity.js — best-effort lookup of a human-readable account name
 * (usually an email address) for a freshly-connected cloud account, so the
 * account list can show "Google Drive — jamesfw@gmail.com" instead of the
 * internal rclone remote name (a random-looking id like
 * "google_drive-ms3r4yph").
 *
 * Every call here is wrapped in try/catch and returns null on any failure
 * (network hiccup, revoked/insufficient scope, an API shape change on the
 * provider's end). The caller always has a safe fallback — showing the
 * technical remote name — so nothing here is required for the app to work.
 *
 * Deliberately uses each provider's own "who am I" endpoint rather than a
 * generic OAuth userinfo endpoint, because rclone's default OAuth scopes
 * (drive access, not profile/email) usually can't call those:
 *   - Google Drive: drive/v3/about?fields=user — part of the Drive API
 *     itself, so it works with plain drive-scope tokens.
 *   - OneDrive: /me/drive owner field — same idea, bundled into the drive
 *     resource Microsoft Graph already returns for Files scope.
 *   - Dropbox: users/get_current_account — basic account info that any
 *     authorized Dropbox app token can read.
 */

// Maps rclone's internal backend "type" (from `rclone config show`) back to
// the provider key CloudMerge's own UI uses. Used for backfilling labels on
// remotes that were connected before this lookup existed, or before a
// given account's own connection attempt got a label (e.g. it was offline
// at the time) — see backfillLabels() below.
const TYPE_TO_PROVIDER = {
  drive: 'google_drive',
  onedrive: 'onedrive',
  dropbox: 'dropbox',
};

async function getRemoteProvider(rclone, safeName) {
  const { stdout, code } = await rclone.run(['config', 'show', safeName]);
  if (code !== 0) return null;
  const match = stdout.match(/^type\s*=\s*(\S+)\s*$/m);
  return (match && TYPE_TO_PROVIDER[match[1]]) || null;
}

async function getAccessToken(rclone, safeName) {
  const { stdout, code } = await rclone.run(['config', 'show', safeName]);
  if (code !== 0) return null;
  const match = stdout.match(/^token\s*=\s*(\{.*\})\s*$/m);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    return parsed.access_token || null;
  } catch (_) {
    return null;
  }
}

async function lookupGoogleDrive(token) {
  const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const user = data && data.user;
  return (user && (user.emailAddress || user.displayName)) || null;
}

async function lookupOneDrive(token) {
  const res = await fetch('https://graph.microsoft.com/v1.0/me/drive?$select=owner', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const owner = data && data.owner && data.owner.user;
  return (owner && (owner.email || owner.displayName)) || null;
}

async function lookupDropbox(token) {
  const res = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return (data && (data.email || (data.name && data.name.display_name))) || null;
}

/**
 * Best-effort: returns a human-readable identity string for a just-
 * connected OAuth remote, or null if it can't be determined for any reason
 * (including providers this doesn't know how to look up, e.g. wd_cloud).
 */
async function lookupIdentity(rclone, safeName, provider) {
  try {
    const token = await getAccessToken(rclone, safeName);
    if (!token) return null;
    if (provider === 'google_drive') return await lookupGoogleDrive(token);
    if (provider === 'onedrive') return await lookupOneDrive(token);
    if (provider === 'dropbox') return await lookupDropbox(token);
    return null;
  } catch (_) {
    return null;
  }
}

/**
 * Best-effort backfill for remotes that were connected before a label
 * existed (upgraded from an older CloudMerge version) or whose lookup
 * didn't succeed the first time (e.g. offline at connect time). Safe to
 * call repeatedly — it only looks up remotes missing a label, and any
 * individual failure is silently skipped rather than retried in a loop.
 */
async function backfillLabels(rclone, accountLabels, remoteNames) {
  const existing = accountLabels.readAll();
  for (const safeName of remoteNames) {
    if (existing[safeName]) continue;
    try {
      const provider = await getRemoteProvider(rclone, safeName);
      if (!provider) continue;
      const identity = await lookupIdentity(rclone, safeName, provider);
      if (identity) accountLabels.setLabel(safeName, identity);
    } catch (_) { /* best-effort — skip and move on */ }
  }
}

module.exports = { lookupIdentity, backfillLabels };
