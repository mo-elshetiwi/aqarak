import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    name: "@aqarak/cdk",
    include: ["src/**/*.test.ts"],
    // Whole-app synthesis with validation plugins needs more time alongside CI builds.
    testTimeout: 60_000,
  },
});
