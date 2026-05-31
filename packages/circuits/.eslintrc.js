// `packages/circuits` ships circom + JS mocha tests, not TypeScript.
// The root .eslintrc.js sets `parserOptions.project: true` which requires
// every linted file to be in a tsconfig. We don't have one here (the
// circuits package compiles via `compile.sh`, not `tsc`), so override:
//
//   1. Tell TypeScript-aware rules not to require `project` info.
//   2. Disable rules that are noisy in test scaffolding (no-var-requires,
//      explicit return types) — circom test files are pragmatic CommonJS.
//
// This file keeps the package linted cleanly without dragging the root
// config into a circuit-specific exception.

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    // Intentionally NOT setting `project` — typed linting requires a
    // tsconfig that includes every linted file, and this package is JS.
  },
  env: {
    node: true,
    mocha: true,
    es2022: true,
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended'],
  rules: {
    'no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    'no-console': 'off',
    'no-var': 'error',
    'prefer-const': 'error',
  },
  ignorePatterns: ['node_modules/', 'build/', 'coverage/'],
  overrides: [
    {
      // Property tests interleave fc.assert with mocha — allow `it.skip`
      // style and unused `_e` exception bindings without flagging.
      files: ['test/**/*.js'],
      rules: {
        'no-empty': 'off',
      },
    },
  ],
};
