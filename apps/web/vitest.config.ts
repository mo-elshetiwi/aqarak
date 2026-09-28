import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  test: {
    maxWorkers: 2,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "components",
          environment: "jsdom",
          testTimeout: 30_000,
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./src/test/setup.ts", "./src/test/navigation-mock.tsx"],
        },
      },
    ],
  },
});
