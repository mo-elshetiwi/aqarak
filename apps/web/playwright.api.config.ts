import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
const origin = "http://127.0.0.1:3100";
export default defineConfig({
  testDir: "./e2e-api",
  workers: 1,
  retries: 0,
  timeout: 600_000,
  expect: { timeout: 90_000 },
  preserveOutput: "never",
  use: {
    baseURL: origin,
    actionTimeout: 30_000,
    navigationTimeout: 90_000,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @aqarak/api dev:local",
      env: {
        IDENTITY_PROVIDER: "local",
        LOCAL_IDENTITY_CONFIRMATION_CODE: "246810",
        PORT: "4010",
        APP_ORIGIN: origin,
        EMAIL_FROM_ADDRESS: "",
        EMAIL_CONFIGURATION_SET_NAME: "",
      },
      url: "http://127.0.0.1:4010/v1/health",
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: "pnpm start --hostname 127.0.0.1 --port 3100",
      env: {
        AQARAK_API_MODE: "http",
        AQARAK_API_BASE_URL: "http://127.0.0.1:4010",
        AQARAK_APP_ORIGIN: origin,
        AQARAK_SESSION_SECRET: randomBytes(32).toString("base64url"),
      },
      url: `${origin}/en/sign-in`,
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
