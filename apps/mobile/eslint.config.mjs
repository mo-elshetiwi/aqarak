import { expo } from "@aqarak/config/eslint/expo.mjs";
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
  ...expo,
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
    files: ["**/*.config.*", "src/app/**/*.tsx"],
    rules: { "no-restricted-syntax": ["error", "TSEnumDeclaration"] },
  },

  prettier,
];
