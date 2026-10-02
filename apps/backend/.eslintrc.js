module.exports = {
  extends: ["../../config/.eslintrc.js"],
  parserOptions: {
    project: ["./tsconfig.json"],
    tsconfigRootDir: __dirname,
  },
  rules: {
    // retentionPurge.ts prunes in deliberate `while (true)` batch loops.
    "no-constant-condition": ["error", { checkLoops: false }],
    "@typescript-eslint/no-unsafe-assignment": "off",
  },
};
