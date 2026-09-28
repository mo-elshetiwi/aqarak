import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  developmentAccount,
  environmentOutputsSchema,
  mapDevOutputs,
  serialiseOutputs,
} from "./outputs";

beforeEach(() => vi.stubEnv("CDK_DEFAULT_ACCOUNT", undefined));
afterEach(() => vi.unstubAllEnvs());

const deployedOutputs = {
  Data: {
    ClusterArn: "arn:aws:rds:us-east-1:000000000000:cluster:test",
    AppSecretArn:
      "arn:aws:secretsmanager:us-east-1:000000000000:secret:app-test",
    MasterSecretArn:
      "arn:aws:secretsmanager:us-east-1:000000000000:secret:master-test",
    DatabaseName: "aqarak",
    PipelineSecretArn:
      "arn:aws:secretsmanager:us-east-1:000000000000:secret:pipeline-test",
    SchedulerSecretArn:
      "arn:aws:secretsmanager:us-east-1:000000000000:secret:scheduler-test",
  },
  Identity: {
    UserPoolId: "us-east-1_test",
    WebClientId: "web123",
    MobileClientId: "mobile123",
  },
  Storage: {
    DocumentsBucketName: "documents-test",
    IssuedBucketName: "issued-test",
    AuditAnchorsBucketName: "anchors-test",
  },
  Api: {
    ApiUrl: "https://test.execute-api.us-east-1.amazonaws.com/dev/",
    ProviderKeysSecretArn:
      "arn:aws:secretsmanager:us-east-1:000000000000:secret:provider-test",
  },
  Email: { EmailConfigurationSetName: "email-test" },
};

describe("application outputs contract", () => {
  it("AC-7 committed development outputs satisfy the exact public contract", () => {
    const text = readFileSync(
      new URL("../outputs/dev.json", import.meta.url),
      "utf8",
    );
    const raw: unknown = JSON.parse(text);
    const outputs = environmentOutputsSchema.parse(raw);
    expect(outputs.stage).toBe("dev");
    expect(Object.keys(outputs).some((key) => /master/i.test(key))).toBe(false);
    expect(Object.keys(outputs).length).toBeGreaterThanOrEqual(13);
    expect(text).toBe(serialiseOutputs(outputs));
  });

  it("maps only the 16 application fields and excludes master identifiers", () => {
    const outputs = mapDevOutputs(deployedOutputs);
    expect(Object.keys(outputs)).toHaveLength(16);
    expect(environmentOutputsSchema.safeParse(outputs).success).toBe(true);
    expect(JSON.stringify(outputs)).not.toContain("master");
  });
  it("rejects missing, duplicate and wrong-account outputs", () => {
    expect(() => mapDevOutputs({})).toThrow("ApiUrl");
    expect(() =>
      mapDevOutputs({ ...deployedOutputs, Duplicate: deployedOutputs.Api }),
    ).toThrow("exactly one ApiUrl");
    expect(() =>
      mapDevOutputs({
        ...deployedOutputs,
        Data: {
          ...deployedOutputs.Data,
          ClusterArn: "arn:aws:rds:us-east-1:111111111111:cluster:test",
        },
      }),
    ).toThrow("account 000000000000");
  });
  it("rejects unknown fields instead of silently publishing them", () => {
    const outputs = mapDevOutputs(deployedOutputs);
    expect(
      environmentOutputsSchema.safeParse({
        ...outputs,
        masterSecretArn: deployedOutputs.Data.MasterSecretArn,
      }).success,
    ).toBe(false);
  });
  it("writes sorted keys with two-space indentation and a final newline", () => {
    const outputs = mapDevOutputs(deployedOutputs);
    const text = serialiseOutputs(outputs);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.split("\n")[1]).toMatch(/^ {2}"apiUrl":/);
    const parsed: unknown = JSON.parse(text);
    expect(Object.keys(environmentOutputsSchema.parse(parsed))).toHaveLength(
      16,
    );
    expect(Object.keys(JSON.parse(text) as Record<string, unknown>)).toEqual(
      Object.keys(outputs).sort(),
    );
  });
});

describe("configured development output accounts", () => {
  const account = "111111111111";
  const configured: unknown = JSON.parse(
    JSON.stringify(deployedOutputs).replaceAll("000000000000", account),
  );

  it("accepts the configured account for all exported ARNs", () => {
    const outputs = mapDevOutputs(configured, account);
    expect(developmentAccount(outputs)).toBe(account);
    expect(serialiseOutputs(outputs)).toContain(`:${account}:`);
  });

  it("uses the development environment fallback for output validation", () => {
    vi.stubEnv("CDK_DEFAULT_ACCOUNT", account);
    expect(mapDevOutputs(configured).clusterArn).toContain(`:${account}:`);
    expect(() => mapDevOutputs(deployedOutputs)).toThrow(`account ${account}`);
  });

  it.each([
    "clusterArn",
    "appSecretArn",
    "pipelineSecretArn",
    "schedulerSecretArn",
    "providerKeysSecretArn",
  ] as const)("rejects a mismatched %s", (key) => {
    const outputs = mapDevOutputs(configured, account);
    const arn = outputs[key];
    expect(arn).toBeDefined();
    expect(() =>
      developmentAccount(
        { ...outputs, [key]: arn?.replace(account, "222222222222") },
        account,
      ),
    ).toThrow(`account ${account}`);
  });

  it("rejects production outputs and conflicting smoke account overrides", () => {
    const outputs = mapDevOutputs(configured, account);
    expect(() => developmentAccount({ ...outputs, stage: "prod" })).toThrow();
    vi.stubEnv("CDK_DEFAULT_ACCOUNT", "222222222222");
    expect(() => developmentAccount(outputs)).toThrow("account 222222222222");
  });
});
