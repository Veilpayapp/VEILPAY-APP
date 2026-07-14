#!/usr/bin/env node
/**
 * UX-002: CI-safe Maestro flow gate.
 *
 * Full Maestro device runs need an emulator/device and a built APK — not
 * available on every CI runner. This script enforces that the critical
 * onboarding + send flows stay present, parseable, and anchored to real
 * testIDs that still exist in the consumer-app source.
 *
 * Run: node scripts/validate-maestro-flows.mjs
 * Exit 0 on success, 1 on failure.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const flowsDir = path.join(root, 'e2e', 'flows');
const consumerSrc = path.join(root, 'apps', 'consumer-app', 'src');

/** Flows that must exist and stay wired (UX-002 minimum). */
const REQUIRED_FLOWS = [
  {
    file: 'onboarding.yaml',
    requiredIds: ['onboarding-get-started', 'wallet-connect-create', 'wallet-connect-import'],
  },
  {
    file: 'send_payment.yaml',
    requiredIds: [
      'home-action-send',
      'send-recipient-input',
      'send-amount-input',
      'send-continue-button',
    ],
  },
];

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, acc);
    else if (/\.(tsx|ts|jsx|js)$/.test(entry.name)) acc.push(p);
  }
  return acc;
}

function collectSourceIds(files) {
  const ids = new Set();
  const re = /testID\s*=\s*\{?\s*["'`]([^"'`]+)["'`]/g;
  const templateRe = /testID=\{`([^`$]+)/g;
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    let m;
    while ((m = re.exec(text))) ids.add(m[1]);
    // home-action-${label.toLowerCase()} → home-action-send etc.
    if (text.includes('home-action-${')) {
      for (const label of ['send', 'scan', 'receive', 'swap', 'faucet', 'shield', 'transfer', 'unshield', 'public']) {
        ids.add(`home-action-${label}`);
      }
    }
    while ((m = templateRe.exec(text))) {
      if (!m[1].includes('${')) ids.add(m[1]);
    }
  }
  return ids;
}

function extractYamlIds(yaml) {
  const ids = [];
  const re = /id:\s*["']?([a-zA-Z0-9_-]+)["']?/g;
  let m;
  while ((m = re.exec(yaml))) ids.push(m[1]);
  return ids;
}

function main() {
  const errors = [];
  const sourceFiles = walk(consumerSrc);
  const sourceIds = collectSourceIds(sourceFiles);

  for (const flow of REQUIRED_FLOWS) {
    const full = path.join(flowsDir, flow.file);
    if (!fs.existsSync(full)) {
      errors.push(`Missing required flow: e2e/flows/${flow.file}`);
      continue;
    }
    const yaml = fs.readFileSync(full, 'utf8');
    if (!yaml.includes('appId:')) {
      errors.push(`${flow.file}: missing appId`);
    }
    if (!/assertVisible|tapOn|inputText/.test(yaml)) {
      errors.push(`${flow.file}: no actionable Maestro steps`);
    }
    const yamlIds = extractYamlIds(yaml);
    for (const id of flow.requiredIds) {
      if (!yamlIds.includes(id)) {
        errors.push(`${flow.file}: missing required test id reference "${id}"`);
      }
      if (!sourceIds.has(id)) {
        errors.push(`${flow.file}: test id "${id}" not found in consumer-app source`);
      }
    }
  }

  if (errors.length) {
    console.error('UX-002 Maestro validation failed:');
    for (const e of errors) console.error(' -', e);
    process.exit(1);
  }

  console.log(
    `UX-002 Maestro validation ok (${REQUIRED_FLOWS.length} critical flows, testIDs present in source)`
  );
}

main();
