import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  localDate,
  propertyId,
  type OwnerGateMandate,
} from "../properties/lib/domain";
import { app } from "../../app";
import { resolveIdentity } from "../properties/lib/identity";
import { gate, maskEid, maskPassport } from "../properties/lib/gate";
import {
  createOwnerSchema,
  bankSchema,
  mandateSchema,
  validIban,
} from "../properties/lib/schemas";
import { createOwnersApp } from "./index";
const company = randomUUID();
describe("Owners route boundary", () => {
  it("AC-1 mounted owners module returns SESSION_INVALID without identity", async () => {
    const response = await app.request(`/v1/companies/${company}/owners`);
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    expect(await response.json()).toMatchObject({
      code: "SESSION_INVALID",
      status: 401,
    });
  });
  it("AC-1 reads companyId from the mounted base path", async () => {
    let actual: string | undefined;
    const test = new Hono();
    test.route(
      "/v1/companies/:companyId/owners",
      createOwnersApp({
        identity: (c) => {
          actual = c.req.param("companyId");
          return Promise.resolve(null);
        },
        database: () => {
          throw new Error("No database expected");
        },
      }),
    );
    await test.request(`/v1/companies/${company}/owners`);
    expect(actual).toBe(company);
  });
  it("refuses the former account headers even when they match", async () => {
    const test = new Hono();
    test.get("/", async (c) => c.json({ identity: await resolveIdentity(c) }));
    const response = await test.request("/", {
      headers: {
        "X-Aqarak-Local-Identity": "x".repeat(32),
        "X-Aqarak-Local-Account": randomUUID(),
      },
    });
    expect(await response.json()).toEqual({ identity: null });
  });
});
const p = propertyId.parse(randomUUID());
const on = localDate.parse("2026-09-28");
const mandate: OwnerGateMandate = {
  status: "active",
  propertyIds: [p],
  startsOn: localDate.parse("2026-01-01"),
  endsOn: null,
  ownerGate: true,
};
it.each([
  {
    kind: "self_managed_owner",
    override: null,
    mandate: null,
    value: false,
    source: "self_managed",
  },
  {
    kind: "self_managed_owner",
    override: true,
    mandate,
    value: false,
    source: "self_managed",
  },
  {
    kind: "management_company",
    override: true,
    mandate: null,
    value: true,
    source: "property_override",
  },
  {
    kind: "management_company",
    override: false,
    mandate,
    value: false,
    source: "property_override",
  },
  {
    kind: "management_company",
    override: null,
    mandate,
    value: true,
    source: "mandate",
  },
  {
    kind: "management_company",
    override: null,
    mandate: { ...mandate, ownerGate: false },
    value: false,
    source: "mandate",
  },
  {
    kind: "management_company",
    override: null,
    mandate: null,
    value: true,
    source: "company_default",
  },
  {
    kind: "management_company",
    override: null,
    mandate: { ...mandate, ownerGate: null },
    value: true,
    source: "company_default",
  },
  {
    kind: "management_company",
    override: null,
    mandate: { ...mandate, endsOn: localDate.parse("2026-09-27") },
    value: true,
    source: "company_default",
  },
  {
    kind: "management_company",
    override: null,
    mandate: { ...mandate, propertyIds: [] },
    value: true,
    source: "company_default",
  },
  {
    kind: "management_company",
    override: null,
    mandate: { ...mandate, startsOn: localDate.parse("2026-09-29") },
    value: true,
    source: "company_default",
  },
] as const)("AC-3 R9 gate precedence and source %#", (test) => {
  expect(
    gate(
      { kind: test.kind, defaultOwnerGate: true },
      { id: p, ownerGateOverride: test.override },
      test.mandate,
      on,
    ),
  ).toEqual({ value: test.value, source: test.source });
});
it("AC-4 masks identity numbers without exposing their middle digits", () => {
  expect(maskEid("784000000000035")).toBe("784••••••••••35");
  expect(maskEid("784000000000035")).toHaveLength(15);
  expect(maskPassport("SYNTHETIC123")).toBe("•••••••••123");
  expect(maskEid(null)).toBeNull();
  expect(maskPassport(null)).toBeNull();
});
it.each([
  "AE070331234567890123456",
  "AE070331234567890123455",
  "GB070331234567890123456",
  "AE123",
])("AC-4 IBAN ISO 7064 validation %#", (iban) => {
  expect(validIban(iban)).toBe(iban === "AE070331234567890123456");
});
it("AC-4 validates identity digits, bilingual names, dates and integer fils", () => {
  const owner = {
    fullName: { en: "Synthetic owner", ar: "مالك تجريبي" },
    preferredLanguage: "en",
  };
  expect(
    createOwnerSchema.safeParse({ ...owner, eidNumber: "784000000000035" })
      .success,
  ).toBe(true);
  expect(
    createOwnerSchema.safeParse({ ...owner, eidNumber: "784-000000000035" })
      .success,
  ).toBe(false);
  expect(
    createOwnerSchema.safeParse({ ...owner, fullName: { en: " ", ar: "مالك" } })
      .success,
  ).toBe(false);
  const body = {
    expectedVersion: null,
    ownerGate: null,
    costThresholdFils: "0",
    startsOn: "2026-01-01",
    endsOn: null,
    propertyIds: [],
  };
  expect(mandateSchema.safeParse(body).success).toBe(true);
  for (const patch of [
    { costThresholdFils: "-1" },
    { costThresholdFils: "1.2" },
    { costThresholdFils: 1 },
    { startsOn: "2026-02-30" },
    { endsOn: "2025-01-01" },
  ])
    expect(mandateSchema.safeParse({ ...body, ...patch }).success).toBe(false);
  expect(
    bankSchema.safeParse({
      expectedVersion: 1,
      bankName: "Synthetic bank",
      accountHolder: "Synthetic owner",
      iban: "AE070331234567890123456",
    }).success,
  ).toBe(true);
});
it("IN4 schema refusals do not reach the database", async () => {
  const database = vi.fn(() => {
    throw new Error("No database expected");
  });
  const test = new Hono();
  test.route(
    "/v1/companies/:companyId/owners",
    createOwnersApp({
      identity: () => Promise.resolve({ accountId: randomUUID() }),
      database,
    }),
  );
  const response = await test.request(`/v1/companies/${company}/owners`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify({
      fullName: { en: "Synthetic", ar: "تجريبي" },
      preferredLanguage: "en",
      eidNumber: "bad",
    }),
  });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    field: "eidNumber",
    code: "VALIDATION_FAILED",
  });
  expect(database).not.toHaveBeenCalled();
});

it("IN4 malformed JSON returns an RFC 9457 schema problem", async () => {
  const response = await app.request(`/v1/companies/${company}/owners`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
    },
    body: "{",
  });
  expect(response.status).toBe(400);
  expect(response.headers.get("content-type")).toContain(
    "application/problem+json",
  );
  expect(await response.json()).toMatchObject({ code: "VALIDATION_FAILED" });
});
