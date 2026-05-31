// `packages/auditor` uses `as const` and `as readonly T[]` annotations
// extensively to document that frozen literals are tuple/readonly types
// rather than mutable arrays. ESLint's `no-unnecessary-type-assertion`
// rule is technically correct that these are redundant after Object.freeze
// (which already narrows the structural type), but the assertions are
// load-bearing documentation: they tell every reader that the cardinality
// is fixed at the type level, not just at runtime.
//
// Downgrade the rule to `warn` for this package only so the Audit_Report
// reflects intent rather than churn.

module.exports = {
  extends: ['../../.eslintrc.js'],
  ignorePatterns: [
    'node_modules/',
    'dist/',
    'build/',
    'coverage/',
    // The launcher script is plain JS used by `pnpm test`. Linting it
    // against the `tsconfig.json` parserOptions.project=true config
    // would require including it in tsconfig (defeats the purpose),
    // and re-implementing the rule in plain ESLint adds churn.
    'scripts/',
    // ESLint config files are themselves not part of the typescript
    // project. The root config already ignores `*.config.js`; spell out
    // `.eslintrc.js` explicitly here so the local override is excluded.
    '.eslintrc.js',
  ],
  rules: {
    '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
    // The synthesizers use `async` arrow functions in jest mocks for
    // future-compat (mocks may need to await side effects later); the
    // current bodies are sync. Down-rank the rule rather than making
    // every mock body await `Promise.resolve()`.
    '@typescript-eslint/require-await': 'warn',
    // Property tests intentionally pass typed `never[]` literals via
    // `fc.constant([] as readonly never[])`. Keep `as readonly` allowed.
  },
};
