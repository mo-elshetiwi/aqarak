import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "aws-cdk-lib";
import { getEnvironmentConfig } from "./config";

afterEach(() => vi.unstubAllEnvs());

describe("deployment accounts", () => {
  it("selects each stage's CDK context account before development credentials", () => {
    const app = new App({
      context: { devAccount: "111111111111", prodAccount: "222222222222" },
    });
    const context: Record<string, unknown> = {
      devAccount: app.node.tryGetContext("devAccount"),
      prodAccount: app.node.tryGetContext("prodAccount"),
    };
    expect(getEnvironmentConfig("dev", context, "333333333333").account).toBe(
      "111111111111",
    );
    expect(getEnvironmentConfig("prod", context, "333333333333").account).toBe(
      "222222222222",
    );
  });

  it("uses caller credentials only for development and otherwise uses the placeholder", () => {
    vi.stubEnv("CDK_DEFAULT_ACCOUNT", "333333333333");
    expect(getEnvironmentConfig("dev").account).toBe("333333333333");
    expect(getEnvironmentConfig("prod").account).toBe("000000000000");
    vi.stubEnv("CDK_DEFAULT_ACCOUNT", undefined);
    expect(getEnvironmentConfig("dev").account).toBe("000000000000");
    expect(getEnvironmentConfig("prod").account).toBe("000000000000");
  });

  it.each(["", "123", "abcdefghijkl", 111111111111])(
    "rejects invalid explicit account %s",
    (devAccount) => {
      expect(() => getEnvironmentConfig("dev", { devAccount })).toThrow();
    },
  );
});
