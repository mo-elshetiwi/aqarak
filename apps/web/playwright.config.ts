import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
const port = process.env.WEB_E2E_PORT ?? "3100";
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: "./e2e",
  use: { baseURL, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    env: {
      AQARAK_API_MODE: "mock",
      AQARAK_SESSION_SECRET: randomBytes(32).toString("base64url"),
    },
    command: `pnpm start --hostname 127.0.0.1 --port ${port}`,
    url: `${baseURL}/en`,
    reuseExistingServer: false,
  },
});
