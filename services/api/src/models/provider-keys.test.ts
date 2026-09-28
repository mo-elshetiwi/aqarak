import { GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { describe, expect, it, vi } from "vitest";
import { createProviderKeyResolver } from "./provider-keys";

describe("provider key resolution", () => {
  it("reads the named secret once and caches concurrent cold-start requests", async () => {
    const send = vi
      .fn<
        (command: GetSecretValueCommand) => Promise<{ SecretString: string }>
      >()
      .mockResolvedValue({
        SecretString: JSON.stringify({ openai: "synthetic-provider-value" }),
      });
    const resolve = createProviderKeyResolver({ send });
    const results = await Promise.all([
      resolve({ secretArn: "provider-secret" }),
      resolve({ secretArn: "provider-secret" }),
    ]);
    expect(results).toEqual([
      "synthetic-provider-value",
      "synthetic-provider-value",
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0].input).toEqual({
      SecretId: "provider-secret",
    });
  });
  it("prefers an explicit local credential without requesting the secret", async () => {
    const send = vi.fn();
    expect(
      await createProviderKeyResolver({ send })({
        directKey: "synthetic-local-value",
        secretArn: "provider-secret",
      }),
    ).toBe("synthetic-local-value");
    expect(send).not.toHaveBeenCalled();
  });
  it("keeps the degraded path available for an empty provider secret", async () => {
    expect(
      await createProviderKeyResolver({
        send: vi.fn().mockResolvedValue({ SecretString: '{"openai":""}' }),
      })({ secretArn: "provider-secret" }),
    ).toBeUndefined();
  });
  it("rejects malformed secret contents without accepting a credential", async () => {
    await expect(
      createProviderKeyResolver({
        send: vi.fn().mockResolvedValue({ SecretString: '{"openai":42}' }),
      })({ secretArn: "provider-secret" }),
    ).rejects.toThrow();
  });
});
