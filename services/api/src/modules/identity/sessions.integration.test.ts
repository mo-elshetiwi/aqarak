import { randomBytes } from "node:crypto";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import { accountTx, databaseInstant, rows, sha256 } from "./database";
import { harness, securityTypes } from "./integration-support";
it("I-14 signs out a web session and rejects forged and malformed session credentials", async () => {
  const h = harness();
  const account = await h.account();
  expect(
    (await h.request("POST", "/v1/auth/sign-out", { account })).status,
  ).toBe(204);
  for (const authorization of [
    `Session ${account.session}`,
    `Session ${randomBytes(32).toString("base64url")}`,
    "Session malformed",
    "",
    "Basic anything",
  ]) {
    const response = await h.request("GET", "/v1/me", { authorization });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "SESSION_INVALID" });
  }
  expect(await securityTypes(h, account)).toEqual([
    "sign_up",
    "sign_up_confirmed",
    "sign_in",
    "sign_out",
  ]);
});
it("I-14 records idle expiration only once", async () => {
  const h = harness();
  const account = await h.account();
  h.setTime(new Date(h.deps.clock().getTime() + 8 * 3600_000 + 60_000));
  for (let attempt = 0; attempt < 2; attempt++)
    expect((await h.request("GET", "/v1/me", { account })).status).toBe(401);
  expect(
    (await securityTypes(h, account)).filter(
      (type) => type === "session_expired",
    ),
  ).toHaveLength(1);
});
it("I-14 slides idle expiry at most once per minute and bounds it by absolute expiry", async () => {
  const h = harness();
  const account = await h.account();
  const start = h.deps.clock();
  const snapshot = async (): Promise<Record<string, unknown>> =>
    accountTx(h.deps, account.id, async (tx) =>
      z
        .record(z.string(), z.unknown())
        .parse(
          (
            await rows(
              tx,
              "select last_seen_at,idle_expires_at,expires_at from ops.auth_session where session_hash=:hash",
              { hash: sha256(account.session) },
            )
          )[0],
        ),
    );
  const original = await snapshot();
  h.setTime(new Date(start.getTime() + 30_000));
  expect((await h.request("GET", "/v1/me", { account })).status).toBe(200);
  expect(await snapshot()).toEqual(original);
  h.setTime(new Date(start.getTime() + 61_000));
  expect((await h.request("GET", "/v1/me", { account })).status).toBe(200);
  const slid = await snapshot();
  expect(databaseInstant(slid.idle_expires_at).getTime()).toBe(
    start.getTime() + 61_000 + 8 * 3600_000,
  );
  await accountTx(h.deps, account.id, (tx) =>
    rows(
      tx,
      "update ops.auth_session set idle_expires_at=expires_at where session_hash=:hash",
      { hash: sha256(account.session) },
    ),
  );
  h.setTime(new Date(databaseInstant(slid.expires_at).getTime() - 1800_000));
  expect((await h.request("GET", "/v1/me", { account })).status).toBe(200);
  const bounded = await snapshot();
  expect(bounded.idle_expires_at).toBe(bounded.expires_at);
  h.setTime(new Date(databaseInstant(slid.expires_at).getTime() + 1));
  expect((await h.request("GET", "/v1/me", { account })).status).toBe(401);
});
it("I-15 maps an unavailable identity provider without writing a security event", async () => {
  const h = harness();
  const account = await h.account();
  const execute = vi.spyOn(h.deps.executor, "execute");
  h.deps.identityProvider = {
    ...h.deps.identityProvider,
    signUp: () => Promise.reject(new Error("Synthetic unavailable")),
    signInWithPassword: () =>
      Promise.reject(new Error("Synthetic unavailable")),
  };
  execute.mockClear();
  for (const path of ["sign-up", "sign-in"]) {
    const response = await h.request("POST", `/v1/auth/${path}`, {
      body: {
        email: account.email,
        password: "Synthetic-Only-123!",
        fullName: "Synthetic Person",
        locale: "en",
        client: "web",
      },
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "UNAVAILABLE" });
  }
  expect(execute).not.toHaveBeenCalled();
});
