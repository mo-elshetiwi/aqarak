import { describe, expect, it } from "vitest";
import { configFromEnvironment, runtimeConfigSchema } from "./config";

const environment = {
  DATABASE_CLUSTER_ARN: "cluster",
  APP_SECRET_ARN: "app",
  PIPELINE_SECRET_ARN: "pipeline",
  SCHEDULER_SECRET_ARN: "scheduler",
  DATABASE_NAME: "aqarak",
  DOCUMENTS_BUCKET_NAME: "documents",
  ISSUED_BUCKET_NAME: "issued",
  AUDIT_ANCHORS_BUCKET_NAME: "anchors",
  COGNITO_USER_POOL_ID: "pool",
  COGNITO_CLIENT_IDS: JSON.stringify({ web: "web", mobile: "mobile" }),
  APP_ORIGIN: "https://dev.aqarak.ae",
  EMAIL_FROM_ADDRESS: "notifications@dev.aqarak.ae",
  EMAIL_CONFIGURATION_SET: "email",
  PROVIDER_KEYS_SECRET_ARN: "providers",
  STAGE: "dev",
  AWS_REGION: "us-east-1",
};
describe("runtime configuration contract", () => {
  it("requires every deployed value and parses named clients", () => {
    expect(runtimeConfigSchema.parse(environment)).toMatchObject({
      COGNITO_CLIENT_IDS: { web: "web", mobile: "mobile" },
      EXTRACTION_TIMEOUT_MS: 20000,
      DOCUMENT_KEY_PREFIX: "",
    });
    for (const key of Object.keys(environment).filter(
      (key) => key !== "STAGE",
    )) {
      const missing = Object.fromEntries(
        Object.entries(environment).filter(([name]) => name !== key),
      );
      expect(runtimeConfigSchema.safeParse(missing).success, key).toBe(false);
    }
  });
  it.each(["0", "-1", "25000", "29000", "not-a-number"])(
    "rejects an unsafe timeout %s",
    (timeout) => {
      expect(
        runtimeConfigSchema.safeParse({
          ...environment,
          EXTRACTION_TIMEOUT_MS: timeout,
        }).success,
      ).toBe(false);
    },
  );
  it("does not accept branch-specific aliases as deployed configuration", () => {
    expect(
      runtimeConfigSchema.safeParse({
        ...environment,
        APP_SECRET_ARN: undefined,
        DATABASE_SECRET_ARN: "old",
      }).success,
    ).toBe(false);
    expect(configFromEnvironment({})).toMatchObject({
      STAGE: "local",
      EXTRACTION_TIMEOUT_MS: 20000,
    });
  });
});
