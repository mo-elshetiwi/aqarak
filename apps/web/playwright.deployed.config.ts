import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import outputs from "../../infra/cdk/outputs/dev.json" with { type: "json" };

const origin = "http://127.0.0.1:3100";
process.env.AQARAK_DEPLOYED_JOURNEY = "1";
process.env.AQARAK_API_BASE_URL = outputs.apiUrl;
process.env.AQARAK_DEV_USER_POOL_ID = outputs.userPoolId;
export default defineConfig({
  testDir: "./e2e-api",
  testMatch: "local-journey.spec.ts",
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/deployed-journey.json" }],
  ],
  workers: 1,
  retries: 0,
  timeout: 900_000,
  expect: { timeout: 45_000 },
  preserveOutput: "never",
  use: {
    baseURL: origin,
    actionTimeout: 30_000,
    navigationTimeout: 45_000,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm start --hostname 127.0.0.1 --port 3100",
    env: {
      AQARAK_API_MODE: "http",
      AQARAK_API_BASE_URL: outputs.apiUrl,
      AQARAK_APP_ORIGIN: origin,
      AQARAK_SESSION_SECRET: randomBytes(32).toString("base64url"),
    },
    url: `${origin}/en/sign-in`,
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
