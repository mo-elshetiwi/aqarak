import { base } from "./eslint/base.mjs";
import prettier from "eslint-config-prettier/flat";
export default [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "dist/**",
      "coverage/**",
      "cdk.out/**",
      ".expo/**",
      "next-env.d.ts",
      "expo-env.d.ts",
    ],
  },
  ...base,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: { parserOptions: { projectService: false } },
  },
  {
    files: ["**/*.config.*"],
    rules: { "no-restricted-syntax": ["error", "TSEnumDeclaration"] },
  },

  prettier,
];
