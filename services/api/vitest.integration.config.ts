import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    name: "@aqarak/api-integration",
    include: [
      "src/**/*.integration.test.ts",
      "src/modules/contracts/tests/database.test.ts",
    ],
    maxWorkers: 2,
    testTimeout: 180000,
    hookTimeout: 180000,
  },
});
