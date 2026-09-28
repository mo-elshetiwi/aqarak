import { describe, expect, it, vi } from "vitest";
import { ok } from "@aqarak/domain";
import { getMessages } from "@aqarak/i18n";
import {
  MOCK_COMPANY_A_ID,
  MOCK_COMPANY_B_ID,
  MOCK_ACCOUNT_IDS,
  MOCK_ACCOUNTS,
} from "@/lib/api/mock-fixtures";
import { createEstateHttpApi } from "../server/http-adapter";
import {
  createEstateMockApi,
  createEstateMockStore,
} from "../server/mock-adapter";
import { routes } from "../server/routes";
import { problemCodeSchema } from "../contract";
vi.mock("server-only", () => ({}));
const key = () => crypto.randomUUID().replaceAll("-", "");
const company = MOCK_COMPANY_A_ID;
const input = {
  fullName: { en: "Synthetic Owner", ar: "مالك تجريبي" },
  preferredLanguage: "en" as const,
};
const session = "synthetic-session";
function mock() {
  const fixture = MOCK_ACCOUNTS.find((a) => a.handle === "manager-1");
  if (!fixture) throw new Error("Missing synthetic manager");
  return createEstateMockApi({
    store: createEstateMockStore(),
    getMe: () =>
      Promise.resolve(
        ok({
          account: {
            id: MOCK_ACCOUNT_IDS["manager-1"],
            email: fixture.email,
            displayName: fixture.name.en,
            locale: "en",
          },
          contexts: fixture.contexts,
        }),
      ),
  });
}
describe("AC-1 HTTP estate adapter", () => {
  it("sends authenticated uncached reads and idempotent commands", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ items: [], nextCursor: null }))
      .mockResolvedValueOnce(
        Response.json(
          {
            owner: {
              id: crypto.randomUUID(),
              version: 1,
              fullName: input.fullName,
              selfManaged: false,
              linked: false,
            },
          },
          { status: 201 },
        ),
      );
    const api = createEstateHttpApi("https://api.example.com", transport);
    expect((await api.listOwners(session, company, {})).ok).toBe(true);
    const options = transport.mock.calls[0]?.[1];
    expect(options).toMatchObject({
      cache: "no-store",
      redirect: "error",
      headers: {
        Authorization: `Session ${session}`,
        Accept: "application/json",
      },
    });
    expect(options).not.toHaveProperty("body");
    const idempotencyKey = key();
    expect(
      (await api.createOwner(session, company, input, [], idempotencyKey)).ok,
    ).toBe(true);
    expect(transport.mock.calls[1]?.[1]?.headers).toMatchObject({
      "Idempotency-Key": idempotencyKey,
      "X-Aqarak-Channel": "web_form",
      "Content-Type": "application/json",
    });
  });
  it.each([
    [409, { code: "VERSION_CONFLICT" }, "VERSION_CONFLICT", 409],
    [409, { code: "unknown" }, "VERSION_CONFLICT", 409],
    [500, { code: "FORBIDDEN" }, "UNAVAILABLE", 503],
    [200, { items: "invalid" }, "UNAVAILABLE", 503],
  ] as const)(
    "maps response %s safely",
    async (status, body, code, expectedStatus) => {
      const api = createEstateHttpApi(
        "https://api.example.com",
        vi.fn<typeof fetch>().mockResolvedValue(
          Response.json(body, {
            status,
            headers: { "Content-Type": "application/problem+json" },
          }),
        ),
      );
      expect(await api.listOwners(session, company, {})).toEqual({
        ok: false,
        error: { status: expectedStatus, code },
      });
    },
  );
  it("maps network failures and rejects unsafe base URLs", async () => {
    const api = createEstateHttpApi(
      "http://localhost:3000",
      vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")),
    );
    expect(await api.listOwners(session, company, {})).toMatchObject({
      error: { code: "UNAVAILABLE" },
    });
    for (const url of [
      "http://example.com",
      "https://u:p@example.com",
      "https://example.com?q=x",
      "https://example.com#x",
      "",
    ])
      expect(() => createEstateHttpApi(url)).toThrow();
  });
});
describe("AC-2 mock contract", () => {
  it("replays the same command, rejects key reuse and stale writes", async () => {
    const api = mock();
    const k = key();
    const first = await api.createOwner(session, company, input, [], k);
    expect(await api.createOwner(session, company, input, [], k)).toEqual(
      first,
    );
    expect(
      await api.createOwner(
        session,
        company,
        {
          ...input,
          fullName: { en: "Another Synthetic Owner", ar: "مالك تجريبي آخر" },
        },
        [],
        k,
      ),
    ).toMatchObject({ error: { code: "IDEMPOTENCY_KEY_REUSED" } });
    const list = await api.listOwners(session, company, {
      q: "Synthetic Owner",
    });
    expect(list.ok && list.value.items).toHaveLength(1);
    if (!first.ok) throw new Error("Create failed");
    expect(
      await api.updateOwner(
        session,
        company,
        { expectedVersion: 2, preferredLanguage: "ar" },
        [first.value.owner.id],
        key(),
      ),
    ).toMatchObject({ error: { code: "VERSION_CONFLICT" } });
  });
  it("rejects delist on vacant and hides foreign companies", async () => {
    const api = mock();
    const list = await api.listProperties(session, company, {});
    if (!list.ok || !list.value.items[0]) throw new Error("Missing property");
    const detail = await api.getProperty(session, company, {}, [
      list.value.items[0].id,
    ]);
    if (!detail.ok) throw new Error("Missing property");
    const unit = detail.value.units.find((u) => u.status === "vacant");
    if (!unit) throw new Error("Missing unit");
    expect(
      await api.changeUnitStatus(
        session,
        company,
        {
          expectedVersion: unit.version,
          command: "delist",
          reason: "Synthetic transition test",
        },
        [detail.value.id, unit.id],
        key(),
      ),
    ).toMatchObject({ error: { code: "INVALID_TRANSITION" } });
    expect(await api.listOwners(session, MOCK_COMPANY_B_ID, {})).toMatchObject({
      error: { code: "NOT_FOUND" },
    });
    expect(detail.value.units).toHaveLength(12);
  });
  it("validates seeded response schemas and document review ordering", async () => {
    const api = mock();
    const list = await api.listOwners(session, company, {});
    expect(
      list.ok && routes.listOwners.output.safeParse(list.value).success,
    ).toBe(true);
    if (!list.ok || !list.value.items[0]) throw new Error("Missing owner");
    const ownerId = list.value.items[0].id;
    const upload = await api.requestOwnerUpload(
      session,
      company,
      {
        docType: "emirates_id",
        byteSize: 12,
        contentType: "image/png",
        sha256: "0".repeat(64),
      },
      [ownerId],
      key(),
    );
    if (!upload.ok) throw new Error("Upload request failed");
    const ids = [
      ownerId,
      upload.value.documentId,
      upload.value.documentVersionId,
    ];
    expect(
      await api.acceptOwnerDocument(
        session,
        company,
        { expectedVersion: 1, expiryDate: "2028-01-01" },
        ids,
        key(),
      ),
    ).toMatchObject({ error: { code: "SCAN_NOT_CLEAN" } });
    const check = await api.checkOwnerDocument(
      session,
      company,
      {},
      ids,
      key(),
    );
    if (!check.ok) throw new Error("Check failed");
    expect(
      await api.acceptOwnerDocument(
        session,
        company,
        { expectedVersion: check.value.version.version },
        ids,
        key(),
      ),
    ).toMatchObject({ error: { code: "EXPIRY_REQUIRED" } });
  });
});
it("AC-10 provides identical estate key paths and every problem in both languages", () => {
  function paths(value: unknown, prefix = ""): string[] {
    return typeof value === "object" && value !== null
      ? Object.entries(value).flatMap(([key, child]) =>
          paths(child, `${prefix}.${key}`),
        )
      : [prefix];
  }
  for (const namespace of ["Owners", "Properties", "Units"] as const) {
    expect(paths(getMessages("en")[namespace])).toEqual(
      paths(getMessages("ar")[namespace]),
    );
    for (const code of problemCodeSchema.options) {
      expect(getMessages("en")[namespace].problems[code]).toBeTruthy();
      expect(getMessages("ar")[namespace].problems[code]).toBeTruthy();
    }
  }
});

it("collects all owner options and refuses a repeated pagination cursor", async () => {
  const { ownerOptions } = await import("../server/owner-options");
  const api = mock();
  const list = await api.listOwners(session, company, {});
  if (!list.ok) throw new Error("Missing owners");
  const listOwners = vi
    .fn<typeof api.listOwners>()
    .mockResolvedValueOnce(
      ok({ items: list.value.items.slice(0, 2), nextCursor: "2" }),
    )
    .mockResolvedValueOnce(
      ok({ items: list.value.items.slice(2), nextCursor: null }),
    );
  const result = await ownerOptions({ ...api, listOwners }, session, company);
  expect(result.ok && result.value).toHaveLength(4);
  expect(listOwners.mock.calls[1]?.[2]).toEqual({ limit: 100, cursor: "2" });
  listOwners.mockResolvedValue(ok({ items: [], nextCursor: "loop" }));
  expect(
    await ownerOptions({ ...api, listOwners }, session, company),
  ).toMatchObject({ error: { code: "UNAVAILABLE" } });
});

it("rejects a duplicate unit batch atomically and enforces every stale unit write", async () => {
  const api = mock();
  const properties = await api.listProperties(session, company, {});
  if (!properties.ok || !properties.value.items[0])
    throw new Error("Missing property");
  const propertyId = properties.value.items[0].id;
  const duplicate = {
    units: [
      {
        unitNo: "201",
        kind: "apartment" as const,
        use: "residential" as const,
      },
      {
        unitNo: "101",
        kind: "apartment" as const,
        use: "residential" as const,
      },
    ],
  };
  expect(
    await api.createUnits(session, company, duplicate, [propertyId], key()),
  ).toMatchObject({
    error: { code: "UNIT_NUMBER_TAKEN", field: "units[1].unitNo" },
  });
  const detail = await api.getProperty(session, company, {}, [propertyId]);
  if (!detail.ok) throw new Error("Missing detail");
  expect(detail.value.units).toHaveLength(12);
  const unit = detail.value.units[0];
  if (!unit) throw new Error("Missing unit");
  expect(
    await api.updateUnit(
      session,
      company,
      { expectedVersion: 2, bedrooms: 3 },
      [propertyId, unit.id],
      key(),
    ),
  ).toMatchObject({ error: { code: "VERSION_CONFLICT" } });
});

it("preserves problem field paths when an unknown code falls back by status", async () => {
  const api = createEstateHttpApi(
    "https://api.example.com",
    vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        { code: "NEW_VALIDATION_RULE", field: "units[1].unitNo" },
        {
          status: 422,
          headers: { "Content-Type": "application/problem+json" },
        },
      ),
    ),
  );
  expect(await api.listOwners(session, company, {})).toEqual({
    ok: false,
    error: { status: 422, code: "VALIDATION_FAILED", field: "units[1].unitNo" },
  });
});

it("completes the mock owner, mandate, property, document and unit workflow", async () => {
  const api = mock();
  const created = await api.createOwner(
    session,
    company,
    { ...input, email: "synthetic.owner@example.com" },
    [],
    key(),
  );
  if (!created.ok) throw new Error("Owner creation failed");
  const ownerId = created.value.owner.id;
  expect(
    await api.putMandate(
      session,
      company,
      {
        expectedVersion: null,
        ownerGate: false,
        costThresholdFils: "200000",
        feeBp: 500,
        startsOn: "2026-01-01",
        endsOn: null,
        propertyIds: [],
      },
      [ownerId],
      key(),
    ),
  ).toMatchObject({
    ok: true,
    value: { mandate: { ownerGate: false, version: 1 } },
  });
  expect(
    await api.putBankDetails(
      session,
      company,
      {
        expectedVersion: 1,
        bankName: "Synthetic Bank",
        accountHolder: "Synthetic Owner",
        iban: `AE${"0".repeat(21)}`,
      },
      [ownerId],
      key(),
    ),
  ).toMatchObject({ ok: true, value: { owner: { version: 2 } } });
  expect(
    await api.updateOwner(
      session,
      company,
      { expectedVersion: 2, preferredLanguage: "ar" },
      [ownerId],
      key(),
    ),
  ).toMatchObject({ ok: true, value: { owner: { version: 3 } } });
  expect(
    await api.inviteOwner(session, company, {}, [ownerId], key()),
  ).toMatchObject({ ok: true, value: { invitation: { status: "pending" } } });
  expect(
    await api.inviteOwner(session, company, {}, [ownerId], key()),
  ).toMatchObject({ error: { code: "INVITATION_PENDING" } });
  const createdProperty = await api.createProperty(
    session,
    company,
    {
      name: { en: "Synthetic Residence", ar: "مبنى تجريبي" },
      kind: "building",
      use: "residential",
      ownerId,
      ownerGateOverride: null,
    },
    [],
    key(),
  );
  if (!createdProperty.ok) throw new Error("Property creation failed");
  const propertyId = createdProperty.value.property.id;
  const detail = await api.getProperty(session, company, {}, [propertyId]);
  expect(detail).toMatchObject({
    ok: true,
    value: { ownerGate: { value: false, source: "mandate" } },
  });
  expect(
    await api.updateProperty(
      session,
      company,
      { expectedVersion: 1, ownerGateOverride: true },
      [propertyId],
      key(),
    ),
  ).toMatchObject({ error: { code: "REASON_REQUIRED" } });
  expect(
    await api.updateProperty(
      session,
      company,
      {
        expectedVersion: 1,
        ownerGateOverride: true,
        reason: "Synthetic recorded choice",
      },
      [propertyId],
      key(),
    ),
  ).toMatchObject({ ok: true, value: { property: { version: 2 } } });
  const createdUnits = await api.createUnits(
    session,
    company,
    { units: [{ unitNo: "201", use: "residential", kind: "apartment" }] },
    [propertyId],
    key(),
  );
  if (!createdUnits.ok || !createdUnits.value.units[0])
    throw new Error("Unit creation failed");
  const unit = createdUnits.value.units[0];
  expect(
    await api.updateUnit(
      session,
      company,
      { expectedVersion: 1, bedrooms: 2 },
      [propertyId, unit.id],
      key(),
    ),
  ).toMatchObject({ ok: true, value: { unit: { version: 2, bedrooms: 2 } } });
  let expectedVersion = 2;
  for (const command of [
    "list",
    "delist",
    "open_make_ready",
    "close_make_ready",
    "block",
    "unblock",
  ] as const) {
    const result = await api.changeUnitStatus(
      session,
      company,
      {
        expectedVersion,
        command,
        reason: "Synthetic status decision",
        ...(command === "block" ? { blockReason: "owner_use" as const } : {}),
      },
      [propertyId, unit.id],
      key(),
    );
    expect(result.ok).toBe(true);
    expectedVersion++;
  }
  for (const docType of ["title_deed", "site_plan"] as const) {
    const upload = await api.requestPropertyUpload(
      session,
      company,
      {
        docType,
        contentType: "image/png",
        byteSize: 4,
        sha256: "0".repeat(64),
      },
      [propertyId],
      key(),
    );
    if (!upload.ok) throw new Error("Upload request failed");
    expect(upload.value.upload.headers["x-amz-checksum-sha256"]).toBe(
      `${"A".repeat(43)}=`,
    );
    const ids = [
      propertyId,
      upload.value.documentId,
      upload.value.documentVersionId,
    ];
    const checked = await api.checkPropertyDocument(
      session,
      company,
      {},
      ids,
      key(),
    );
    if (!checked.ok) throw new Error("Check failed");
    const result =
      docType === "title_deed"
        ? await api.acceptPropertyDocument(
            session,
            company,
            {
              expectedVersion: checked.value.version.version,
              issueDate: "2026-01-01",
            },
            ids,
            key(),
          )
        : await api.rejectPropertyDocument(
            session,
            company,
            {
              expectedVersion: checked.value.version.version,
              reason: "Synthetic unreadable document",
            },
            ids,
            key(),
          );
    expect(result).toMatchObject({
      ok: true,
      value: {
        version: {
          reviewStatus: docType === "title_deed" ? "accepted" : "rejected",
        },
      },
    });
  }
  const owner = await api.getOwner(session, company, {}, [ownerId]);
  expect(owner).toMatchObject({
    ok: true,
    value: {
      bank: { ibanLast4: "0000" },
      properties: [{ id: propertyId, unitCount: 1 }],
    },
  });
});
