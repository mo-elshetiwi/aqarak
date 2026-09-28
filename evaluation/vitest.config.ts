import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { name: "@aqarak/evaluation", include: ["src/**/*.test.ts"] },
});
