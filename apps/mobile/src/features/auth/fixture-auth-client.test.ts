import { createFixtureAuthClient } from "./fixture-auth-client";
describe("synthetic fixture auth", () => {
  it("issues opaque credentials for fifteen minutes using the injected clock", async () => {
    const now = Date.UTC(2026, 0, 1);
    const client = createFixtureAuthClient(() => now);
    const tokens = await client.signIn({
      username: "manager-1",
      password: "synthetic",
    });
    expect(Date.parse(tokens.accessTokenExpiresAt)).toBe(now + 900_000);
    expect(
      (await client.getMe(tokens.accessToken)).contexts[0]?.capacities,
    ).toEqual(["manager"]);
  });
  it("restores a synthetic account across client instances", async () => {
    const client = createFixtureAuthClient();
    const first = await client.signIn({
      username: "multi-1",
      password: "synthetic",
    });
    const restored = createFixtureAuthClient();
    const tokens = await restored.refresh(first.refreshToken);
    expect((await restored.getMe(tokens.accessToken)).contexts).toHaveLength(2);
  });
  it("rejects unknown usernames and empty passwords", async () => {
    const client = createFixtureAuthClient();
    await expect(
      client.signIn({ username: "unknown", password: "synthetic" }),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
    await expect(
      client.signIn({ username: "manager-1", password: "" }),
    ).rejects.toMatchObject({ code: "invalid_credentials" });
  });
});
