import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    name: "@aqarak/api",
    include: ["src/**/*.test.ts"],
    exclude: [
      "**/*.integration.test.ts",
      "src/modules/contracts/tests/database.test.ts",
    ],
    maxWorkers: 2,
  },
});
