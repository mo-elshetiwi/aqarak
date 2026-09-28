import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    name: "@aqarak/domain",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      thresholds: { perFile: true, lines: 90, branches: 90 },
    },
  },
});
