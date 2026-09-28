import { next } from "@aqarak/config/eslint/next.mjs";
import prettier from "eslint-config-prettier/flat";
const config = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      ".vercel/**",
      "dist/**",
      "coverage/**",
      "cdk.out/**",
      ".expo/**",
      "next-env.d.ts",
      "expo-env.d.ts",
    ],
  },
  ...next,
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
    files: [
      "**/*.config.*",
      "src/app/**/page.tsx",
      "src/app/**/layout.tsx",
      "src/i18n/request.ts",
    ],
    rules: { "no-restricted-syntax": ["error", "TSEnumDeclaration"] },
  },

  prettier,
];

export default config;
