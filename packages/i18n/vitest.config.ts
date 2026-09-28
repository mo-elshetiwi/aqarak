import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { name: "@aqarak/i18n", include: ["src/**/*.test.ts"] },
});
