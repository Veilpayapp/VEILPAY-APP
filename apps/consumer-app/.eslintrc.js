module.exports = {
  extends: ["../../.eslintrc.js"],
  parserOptions: {
    project: ["./tsconfig.json"],
    tsconfigRootDir: __dirname,
  },
  rules: {
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unsafe-assignment": "off",
    "@typescript-eslint/no-unsafe-member-access": "off",
    "@typescript-eslint/no-unsafe-call": "off",
    "@typescript-eslint/no-unsafe-return": "off",
    "@typescript-eslint/no-unsafe-argument": "off",
    "@typescript-eslint/require-await": "off",
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-redundant-type-constituents": "off",
    "@typescript-eslint/restrict-template-expressions": "off",
    "@typescript-eslint/no-floating-promises": "off",
    "@typescript-eslint/unbound-method": "off",
    "@typescript-eslint/no-misused-promises": "off",
    "no-undef": "off",
    "no-empty": "off",
    "@typescript-eslint/no-var-requires": "off",
    "@typescript-eslint/no-unsafe-enum-comparison": "off",
    "no-case-declarations": "off",
    "@typescript-eslint/no-unnecessary-type-assertion": "off"
  },
  ignorePatterns: [
    "babel.config.js", 
    "metro.config.js", 
    "jest.config.js",
    "*.js",
    "node_modules/",
    "dist/",
    "coverage/"
  ],
};
