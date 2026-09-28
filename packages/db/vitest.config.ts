import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { name: "@aqarak/db", include: ["src/**/*.test.ts"] },
});
