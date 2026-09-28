import { base } from "@aqarak/config/eslint/base.mjs";
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
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: ["node:*", "@aws-sdk/*"],
          paths: ["pg", "drizzle-orm", "hono", "next", "react", "react-native"],
        },
      ],
      "no-restricted-properties": [
        "error",
        { object: "Date", property: "now" },
        { object: "Math", property: "random" },
        { object: "crypto", property: "randomUUID" },
      ],
    },
  },
  prettier,
];
