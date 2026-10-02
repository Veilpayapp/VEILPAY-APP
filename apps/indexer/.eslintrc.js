module.exports = {
  extends: ["../../config/.eslintrc.js"],
  parserOptions: {
    project: ["./tsconfig.json"],
    tsconfigRootDir: __dirname,
  },
  rules: {
    "@typescript-eslint/no-unsafe-assignment": "off",
    "@typescript-eslint/no-unsafe-member-access": "off",
    "@typescript-eslint/no-unsafe-call": "off",
    "@typescript-eslint/no-unsafe-argument": "off",
    "@typescript-eslint/require-await": "off",
    "@typescript-eslint/unbound-method": "off",
    "@typescript-eslint/no-unnecessary-type-assertion": "off",
  },
};
