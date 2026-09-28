import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { name: "@aqarak/ui-tokens", include: ["src/**/*.test.ts"] },
});
