import { expect, it } from "vitest";
import { z } from "zod";
import {
  harness,
  securityTypes,
  testPassword,
  assertChain,
} from "./integration-support";
const capacitySchema = z.enum([
  "manager",
  "technician",
  "company_administrator",
  "accountant",
  "owner",
  "tenant",
]);
const meSchema = z.strictObject({
  account: z.strictObject({
    id: z.uuid(),
    displayName: z.string().min(1),
    locale: z.enum(["en", "ar"]),
  }),
  contexts: z.array(
    z.strictObject({
      companyId: z.uuid(),
      companyName: z.strictObject({
        en: z.string().min(1),
        ar: z.string().min(1),
      }),
      isDemo: z.boolean(),
      capacities: z.array(capacitySchema),
    }),
  ),
});
it("I-17 issues, verifies, refreshes and revokes mobile tokens with strict mobile me projection", async () => {
  const h = harness();
  const account = await h.account();
  const company = await h.company(account, "self_managed_owner");
  const signed = await h.request("POST", "/v1/auth/sign-in", {
    body: { username: account.email, password: testPassword, client: "mobile" },
  });
  expect(signed.status).toBe(200);
  const tokens = z
    .strictObject({
      accessToken: z.string(),
      accessTokenExpiresAt: z.iso.datetime(),
      refreshToken: z.string(),
    })
    .parse(await signed.json());
  const response = await h.request("GET", "/v1/me", {
    authorization: `Bearer ${tokens.accessToken}`,
  });
  expect(response.status).toBe(200);
  const me = meSchema.parse(await response.json());
  expect(me.contexts[0]?.capacities).toEqual([
    "company_administrator",
    "manager",
    "owner",
  ]);
  const refresh = await h.request("POST", "/v1/auth/refresh", {
    body: { refreshToken: tokens.refreshToken, client: "mobile" },
  });
  expect(refresh.status).toBe(200);
  const refreshed = z
    .object({ accessToken: z.string(), accessTokenExpiresAt: z.iso.datetime() })
    .parse(await refresh.json());
  expect(refreshed.accessToken).not.toBe(tokens.accessToken);
  const updated = await h.request("PATCH", `/v1/companies/${company}`, {
    authorization: `Bearer ${refreshed.accessToken}`,
    body: { expectedVersion: 1, trn: "MOBILE-TEST" },
  });
  expect(updated.status, h.errors.at(-1)).toBe(200);
  expect(
    (
      await h.request("POST", "/v1/auth/sign-out", {
        authorization: `Bearer ${refreshed.accessToken}`,
        body: { refreshToken: tokens.refreshToken },
      })
    ).status,
  ).toBe(204);
  expect(
    (
      await h.request("POST", "/v1/auth/refresh", {
        body: { refreshToken: tokens.refreshToken, client: "mobile" },
      })
    ).status,
  ).toBe(401);
  expect(await securityTypes(h, account)).toContain("token_refreshed");
  await assertChain(h, company, account);
});
