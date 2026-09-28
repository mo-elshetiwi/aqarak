import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { name: "@aqarak/config", include: ["src/**/*.test.ts"] },
});
