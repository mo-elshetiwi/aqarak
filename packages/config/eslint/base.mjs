import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier/flat";
/** Shared rules for typed modules and JavaScript configuration files. */
export const base = [
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  { languageOptions: { parserOptions: { projectService: true } } },
  {
    rules: {
      "no-console": "error",
      "no-warning-comments": ["error", { terms: ["todo", "fixme", "xxx"] }],
      "no-restricted-syntax": [
        "error",
        "TSEnumDeclaration",
        "ExportDefaultDeclaration",
      ],
      "func-style": ["error", "declaration", { allowArrowFunctions: true }],
      complexity: ["error", 15],
      "max-depth": ["error", 4],
      "max-params": ["error", 4],
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/explicit-module-boundary-types": "error",
    },
  },
  { files: ["**/*.{js,mjs,cjs}"], ...tseslint.configs.disableTypeChecked },
  prettier,
];
