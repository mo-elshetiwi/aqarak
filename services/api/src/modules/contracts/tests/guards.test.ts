import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createWorkflowModules } from "../workflows";
import { contentHash, draftSchema, termsSchema, terms } from "../schema";
import {
  validateContractSchedule,
  validateContractTerms,
  vatFils,
  basisPoints,
  nonNegativeFils,
  ownerGate,
  propertyId,
  localDate,
  transitionContract,
  personAccountId,
  contractId,
  unitId,
  type ContractContext,
  type ContractSnapshot,
} from "../runtime/domain";
import { deviceSummary, traceId } from "../runtime/auth";
import { databaseProblem } from "../runtime/problem";
import type { DraftInput } from "../schema";
const input: DraftInput = {
  tenantId: "00000000-0000-4000-8000-000000000001",
  unitId: "00000000-0000-4000-8000-000000000002",
  termStart: "2026-10-01",
  termEnd: "2027-09-30",
  graceDays: 0,
  annualRentFils: 10000,
  totalFils: 10000,
  depositFils: 1000,
  vatBp: 0,
  instalments: [
    {
      seqNo: 1,
      dueOn: "2026-10-01",
      amountFils: 10000,
      vatFils: 0,
      cheque: null,
    },
  ],
  specialClauses: [],
};
const manager = personAccountId.parse("00000000-0000-4000-8000-000000000003");
const owner = personAccountId.parse("00000000-0000-4000-8000-000000000004");
const tenant = personAccountId.parse(input.tenantId);
function context(): ContractContext {
  return {
    actor: { role: "manager", accountId: manager, sessionAccountId: manager },
    on: localDate.parse("2026-09-28"),
    company: { kind: "management_company", defaultOwnerGate: true },
    property: {
      id: propertyId.parse("00000000-0000-4000-8000-000000000005"),
      ownerGateOverride: null,
    },
    mandate: null,
    blockedUnitIds: [],
    blockingContracts: [],
    tenantExists: true,
    tenantDocumentsAccepted: true,
    ownerAccountActive: true,
  };
}
function state(): ContractSnapshot {
  return {
    id: contractId.parse("00000000-0000-4000-8000-000000000006"),
    status: "draft",
    origin: "app",
    version: {
      number: 1,
      contentHash: contentHash(input),
      submitted: false,
      frozenOwnerGate: null,
      terms: terms(input),
    },
    ownerAccountId: owner,
    tenantAccountId: tenant,
    tenantSignatoryAccountIds: [],
    approvals: [],
    successorId: null,
  };
}
describe("strict draft terms", () => {
  it.each([
    { ...input, unknown: true },
    { ...input, annualRentFils: 100_000_000_001 },
    { ...input, depositFils: 1.5 },
    { ...input, termStart: "2026-02-30" },
    { ...input, vatBp: 100 },
    { ...input, instalments: [] },
    {
      ...input,
      specialClauses: Array.from({ length: 11 }, () => ({
        textEn: "x",
        textAr: "س",
        modelTranslated: false,
      })),
    },
  ])("rejects invalid boundary input %j", (value) => {
    expect(draftSchema.safeParse(value).success).toBe(false);
  });
  it("refuses client provenance and accepts only a UUID suggestion reference", () => {
    const clause = {
      textEn: "Synthetic text",
      textAr: "نص اصطناعي",
      modelTranslated: true,
    };
    expect(
      draftSchema.safeParse({
        ...input,
        specialClauses: [{ ...clause, provenance: null }],
      }).success,
    ).toBe(false);
    expect(
      draftSchema.safeParse({
        ...input,
        specialClauses: [{ ...clause, suggestionId: "forged" }],
      }).success,
    ).toBe(false);
    expect(
      draftSchema.safeParse({
        ...input,
        specialClauses: [{ ...clause, suggestionId: input.tenantId }],
      }).success,
    ).toBe(true);
  });
  it("binds both clause languages, flags, cheque details and dates in the content hash", () => {
    const base = contentHash(input);
    for (const changed of [
      { ...input, termEnd: "2027-10-01" },
      {
        ...input,
        instalments: [
          {
            ...input.instalments[0],
            seqNo: 1,
            dueOn: "2026-10-01",
            amountFils: 10000,
            vatFils: 0,
            cheque: { chequeNo: "123", bankName: "Synthetic Bank" },
          },
        ],
      },
      {
        ...input,
        specialClauses: [
          {
            textEn: "Text",
            textAr: "نص",
            modelTranslated: true,
          },
        ],
      },
    ])
      expect(contentHash(changed)).not.toBe(base);
    expect(contentHash({ ...input, instalments: [...input.instalments] })).toBe(
      base,
    );
  });
  it("validates schedule totals and exact VAT through the shared domain", () => {
    expect(validateContractSchedule(terms(input)).ok).toBe(true);
    expect(
      validateContractSchedule(terms({ ...input, totalFils: 10001 })),
    ).toMatchObject({ ok: false, error: { code: "SCHEDULE_TOTAL_MISMATCH" } });
    expect(vatFils(nonNegativeFils.parse(10001), basisPoints.parse(500))).toBe(
      500,
    );
    expect(
      validateContractTerms({ ...terms(input), unitIds: [] }),
    ).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(termsSchema.safeParse(input).success).toBe(false);
  });
});
describe("authoritative transition guards", () => {
  it.each(["documents", "owner", "overlap", "version"])(
    "refuses invalid submission facts: %s",
    (kind) => {
      const dc = context();
      const s = state();
      const facts =
        kind === "documents"
          ? { ...dc, tenantDocumentsAccepted: false }
          : kind === "owner"
            ? { ...dc, ownerAccountActive: false }
            : kind === "overlap"
              ? {
                  ...dc,
                  blockingContracts: [
                    {
                      id: contractId.parse(
                        "00000000-0000-4000-8000-000000000099",
                      ),
                      unitIds: [unitId.parse(input.unitId)],
                      termStart: localDate.parse(input.termStart),
                      termEnd: localDate.parse(input.termEnd),
                      blocksUnit: true,
                    },
                  ],
                }
              : dc;
      const code = {
        documents: "TENANT_DOCUMENTS_REQUIRED",
        owner: "OWNER_ACCOUNT_REQUIRED",
        overlap: "OVERLAPPING_CONTRACT",
        version: "VERSION_CONFLICT",
      }[kind];
      expect(
        transitionContract(
          s,
          { type: "submit", expectedVersion: kind === "version" ? 2 : 1 },
          facts,
        ),
      ).toMatchObject({ ok: false, error: { code } });
    },
  );
  it("applies self-managed, property and mandate gate precedence", () => {
    const c = context();
    const mandate = {
      status: "active" as const,
      propertyIds: [c.property.id],
      startsOn: localDate.parse("2026-01-01"),
      endsOn: null,
      ownerGate: false,
    };
    expect(ownerGate(c.company, c.property, mandate, c.on)).toBe(false);
    expect(
      ownerGate(
        c.company,
        { ...c.property, ownerGateOverride: true },
        mandate,
        c.on,
      ),
    ).toBe(true);
    expect(
      ownerGate(
        { ...c.company, kind: "self_managed_owner" },
        { ...c.property, ownerGateOverride: true },
        mandate,
        c.on,
      ),
    ).toBe(false);
  });
  it("maps exclusion and foreign reference failures without exposing database details", () => {
    expect(databaseProblem(new Error("23P01 exclusion constraint")).code).toBe(
      "OVERLAPPING_CONTRACT",
    );
    expect(
      databaseProblem(new Error("23503 foreign key constraint")).code,
    ).toBe("INVALID_INPUT");
    expect(databaseProblem(new Error("private database detail")).code).toBe(
      "UNAVAILABLE",
    );
  });
});
it("registers all workflows without environment configuration and refuses missing authentication", async () => {
  const app = new Hono();
  for (const module of createWorkflowModules({
    authenticate: () => Promise.resolve(null),
  })) {
    const routes = new Hono();
    module.register(routes);
    app.route(module.basePath, routes);
  }
  for (const path of ["contracts", "approvals", "notifications"]) {
    const response = await app.request(
      `/v1/companies/${input.tenantId}/${path}`,
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("Content-Type")).toContain(
      "application/problem+json",
    );
  }
});
it("never copies arbitrary user agent text or malformed trace parents", () => {
  const request = new Request("https://example.invalid", {
    headers: {
      "User-Agent": "private-value".repeat(100),
      traceparent: "ff-invalid",
    },
  });
  expect(deviceSummary(request)).toBe("Unknown browser / Unknown platform");
  expect(traceId(request)).toBeNull();
});
