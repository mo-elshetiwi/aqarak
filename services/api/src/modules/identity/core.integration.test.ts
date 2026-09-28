import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { z } from "zod";
import {
  harness,
  events,
  assertChain,
  securityTypes,
} from "./integration-support";
import { rows, json } from "./database";
import { companyContextSchema } from "./accounts";
it("I-1 registers, confirms, signs in and returns an empty web account context", async () => {
  const h = harness();
  const account = await h.account();
  expect(await securityTypes(h, account)).toEqual([
    "sign_up",
    "sign_up_confirmed",
    "sign_in",
  ]);
  const response = await h.request("GET", "/v1/me", { account });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    account: {
      id: account.id,
      email: account.email,
      displayName: "Synthetic Person",
      locale: "en",
    },
    contexts: [],
  });
});
it.each([
  { kind: "management_company", versions: 4 },
  { kind: "self_managed_owner", versions: 6 },
] as const)(
  "I-2/I-3 creates $kind covering $versions row versions and a valid chain",
  async ({ kind }) => {
    const h = harness();
    const account = await h.account();
    const company = await h.company(account, kind);
    const audit = await events(h, company, account);
    expect(audit.map((event) => event.event_type)).toEqual(["company.created"]);
    expect(audit[0]).toMatchObject({
      actor_account_id: account.id,
      actor_role: "company_administrator",
      initiator: "person",
      channel: "web_form",
    });
    expect(Number(audit[0]?.version_after)).toBe(1);
    const covered = await h.inCompany(company, account, (tx) =>
      rows(
        tx,
        "select subject_type,subject_version from audit.event_subject order by subject_type",
      ),
    );
    expect(covered.map((row) => row.subject_type)).toEqual(
      kind === "management_company"
        ? ["account_company_link", "company", "membership", "person_account"]
        : [
            "account_company_link",
            "account_company_link",
            "company",
            "membership",
            "owner",
            "person_account",
          ],
    );
    expect(covered.every((row) => Number(row.subject_version) === 1)).toBe(
      true,
    );
    const response = await h.request("GET", "/v1/me", { account });
    const me = z
      .object({ contexts: z.array(companyContextSchema) })
      .parse(await response.json());
    expect(me.contexts[0]?.staffRoles).toEqual(
      kind === "management_company"
        ? ["company_administrator"]
        : ["company_administrator", "manager"],
    );
    expect(me.contexts[0]?.partyLinks).toHaveLength(
      kind === "management_company" ? 0 : 1,
    );
    await assertChain(h, company, account);
  },
);
it("I-4 refuses a second active company membership and rolls back company creation", async () => {
  const h = harness();
  const account = await h.account();
  const company = await h.company(account);
  const result = await h.request("POST", "/v1/companies", {
    account,
    body: {
      kind: "self_managed_owner",
      name: { en: "Other Company", ar: "شركة أخرى" },
    },
  });
  expect(result.status, h.errors.at(-1)).toBe(403);
  expect(await result.json()).toMatchObject({ code: "FORBIDDEN" });
  expect(
    (await securityTypes(h, account)).filter(
      (type) => type === "company_create_refused",
    ),
  ).toHaveLength(1);
  expect(await events(h, company, account)).toHaveLength(1);
  await assertChain(h, company, account);
});
it("I-5 replays company creation and refuses a changed request hash", async () => {
  const h = harness();
  const account = await h.account();
  const key = randomUUID();
  const body = {
    kind: "management_company",
    name: { en: "Company Replay", ar: "شركة تجريبية" },
    tradeLicenceNumber: "TEST-REPLAY",
  };
  const first = await h.request("POST", "/v1/companies", {
    account,
    body,
    key,
  });
  expect(first.status, h.errors.at(-1)).toBe(201);
  const expected: unknown = await first.json();
  const second = await h.request("POST", "/v1/companies", {
    account,
    body,
    key,
  });
  expect(second.status, h.errors.at(-1)).toBe(201);
  expect(await second.json()).toEqual(expected);
  expect(second.headers.get("Idempotent-Replayed")).toBe("true");
  const changed = await h.request("POST", "/v1/companies", {
    account,
    body: { ...body, name: { en: "Changed Name", ar: "اسم آخر" } },
    key,
  });
  expect(changed.status).toBe(422);
  expect(await changed.json()).toMatchObject({
    code: "IDEMPOTENCY_KEY_REUSED",
  });
  const company = z
    .object({ company: z.object({ id: z.uuid() }) })
    .parse(expected).company.id;
  expect(
    (await events(h, company, account)).map((event) => event.event_type),
  ).toEqual(["company.created", "policy.denied"]);
  await assertChain(h, company, account);
});
it("I-11 updates company settings, rejects stale versions and records canonical policy decisions", async () => {
  const h = harness();
  const account = await h.account();
  const company = await h.company(account);
  const patched = await h.request("PATCH", `/v1/companies/${company}`, {
    account,
    body: { expectedVersion: 1, trn: "TEST-TRN" },
  });
  expect(patched.status, h.errors.at(-1)).toBe(200);
  const stale = await h.request("PATCH", `/v1/companies/${company}`, {
    account,
    body: { expectedVersion: 1, trn: "OTHER" },
  });
  expect(stale.status).toBe(409);
  const audit = await events(h, company, account);
  expect(audit.map((event) => event.event_type)).toEqual([
    "company.created",
    "company.updated",
    "policy.denied",
  ]);
  expect(json(audit[2]?.policy_decision)).toEqual({
    policy_version: "permissions-2026-09-28",
    result: "deny",
    reasons: [
      "VERSION_CONFLICT",
      "route:PATCH /v1/companies/:companyId",
      "capability:company_settings",
      "operation:write",
    ],
  });
  await assertChain(h, company, account);
});
