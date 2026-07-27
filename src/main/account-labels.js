'use strict';

/**
 * account-labels.js — tiny local store mapping an rclone remote's internal
 * name (e.g. "google_drive-ms3r4yph") to a human-readable label (usually
 * the account's email, via account-identity.js) for display purposes only.
 *
 * The rclone remote name itself never changes — this is purely cosmetic,
 * stored in its own small JSON file so a failed lookup or a corrupt file
 * here can never risk the actual account config in rclone.conf.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function getLabelsPath() {
  const dir = path.join(os.homedir(), '.cloudmerge');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'account-labels.json');
}

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(getLabelsPath(), 'utf8'));
  } catch (_) {
    return {};
  }
}

function writeAll(labels) {
  try {
    fs.writeFileSync(getLabelsPath(), JSON.stringify(labels, null, 2));
  } catch (_) { /* cosmetic only — not fatal if this can't be written */ }
}

function setLabel(name, label) {
  const labels = readAll();
  labels[name] = label;
  writeAll(labels);
}

function removeLabel(name) {
  const labels = readAll();
  if (name in labels) {
    delete labels[name];
    writeAll(labels);
  }
}

module.exports = { readAll, setLabel, removeLabel };
