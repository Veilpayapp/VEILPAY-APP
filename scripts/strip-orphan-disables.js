#!/usr/bin/env node
/**
 * Strip orphan `eslint-disable-next-line <rule>` directives that reference
 * react-doctor rules (`unused-file`, `rn-prefer-pressable`,
 * `no-giant-component`, etc). The plugin that defined these rules was
 * never installed, so ESLint reports each occurrence as an error
 * ("Definition for rule '...' was not found.").
 *
 * The plugin is `react-doctor`, a one-off lint tool driven by
 * `react-doctor-report.json`. Its disable directives are leftover
 * scaffolding from a tier-3 cleanup — removing them is safe.
 *
 * Usage: node scripts/strip-orphan-disables.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ORPHAN_RULES = [
  'unused-file',
  'unused-dependency',
  'rn-prefer-pressable',
  'exhaustive-deps',
  'no-giant-component',
  'prefer-useReducer',
  'no-adjust-state-on-prop-change',
  'no-initialize-state',
  'rerender-state-only-in-handlers',
  'no-event-handler',
  'no-chain-state-updates',
  'no-derived-state',
  'no-pass-data-to-parent',
  'rn-no-legacy-shadow-styles',
  'rn-style-prefer-boxshadow',
  'only-export-components',
  'no-react19-deprecated-apis',
  'rn-prefer-expo-image',
  'rn-prefer-reanimated',
  'no-z-index-9999',
  'no-array-index-as-key',
  'no-array-index-key',
  'rn-prefer-content-inset-adjustment',
  'design-no-three-period-ellipsis',
  'no-barrel-import',
  'no-cascading-set-state',
  'async-defer-await',
  'react-hooks/exhaustive-deps',
  'js-flatmap-filter',
  'js-set-map-lookups',
  'rerender-lazy-state-init',
  'jsx-no-jsx-as-prop',
  'rn-no-scrollview-mapped-list',
  'rn-no-dimensions-get',
  'js-index-maps',
  'js-combine-iterations',
  'async-await-in-loop',
  'server-sequential-independent-await',
  'js-hoist-intl',
];

const ROOT = path.resolve(__dirname, '..', 'apps', 'consumer-app');

const SKIP_DIRS = new Set([
  'node_modules',
  '.expo',
  '.expo-export-check',
  'coverage',
  'dist',
  'graphify-out',
  '__mocks__',
]);

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(path.join(dir, entry.name));
      continue;
    }
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (
      name.endsWith('.ts') ||
      name.endsWith('.tsx') ||
      name.endsWith('.js') ||
      name.endsWith('.jsx')
    ) {
      yield path.join(dir, entry.name);
    }
  }
}

const ruleAlternation = ORPHAN_RULES.map((r) =>
  r.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'),
).join('|');

// Match a whole comment line that disables ONLY orphan rules.
// Examples handled:
//   // eslint-disable-next-line unused-file
//   // eslint-disable-next-line unused-file, rn-prefer-pressable
const linePattern = new RegExp(
  String.raw`^\s*//\s*eslint-disable-next-line\s+(?:${ruleAlternation})(?:\s*,\s*(?:${ruleAlternation}))*\s*\r?\n`,
  'gm',
);

// Also handle inline disables on the same line as code:
//   foo, // eslint-disable-next-line unused-file
const inlinePattern = new RegExp(
  String.raw`\s*//\s*eslint-disable-next-line\s+(?:${ruleAlternation})(?:\s*,\s*(?:${ruleAlternation}))*\s*$`,
  'gm',
);

let touched = 0;
let total = 0;

for (const filePath of walk(ROOT)) {
  total += 1;
  let body;
  try {
    body = fs.readFileSync(filePath, 'utf8');
  } catch {
    continue;
  }
  const before = body;
  body = body.replace(linePattern, '');
  body = body.replace(inlinePattern, '');
  if (body !== before) {
    fs.writeFileSync(filePath, body, 'utf8');
    touched += 1;
  }
}

console.log(`scanned=${total} touched=${touched}`);
