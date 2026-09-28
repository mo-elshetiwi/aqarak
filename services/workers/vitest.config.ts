import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { name: "@aqarak/workers", include: ["src/**/*.test.ts"] },
});
