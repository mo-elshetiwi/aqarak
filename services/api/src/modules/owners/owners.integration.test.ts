import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { estateConfig } from "../properties/lib/config";
import {
  integrationApp,
  seedCompany,
  request,
  query,
  countEvents,
  verifyChain,
  validateDenials,
  type SyntheticCompany,
} from "../properties/lib/integration-fixture";
import {
  ownerSummarySchema,
  ownerDetailSchema,
  mandateDetailSchema,
} from "../properties/lib/schemas";
import { param, uuid } from "../properties/lib/sql";
const app = integrationApp();
const synthetic = {
  fullName: { en: "Synthetic individual owner", ar: "مالك فرد تجريبي" },
  preferredLanguage: "en",
  email: "synthetic-owner@example.com",
};
describe.runIf(Boolean(estateConfig().clusterArn))(
  "Owners live Data API acceptance",
  () => {
    let a: SyntheticCompany;
    let b: SyntheticCompany;
    let c: SyntheticCompany;
    let owner: string;
    let ownerVersion: number;
    const key = randomUUID();
    let first: unknown;
    beforeAll(async () => {
      a = await seedCompany("management_company", [
        "admin",
        "accountant",
        "tenant",
        "owner",
        "technician",
      ]);
      b = await seedCompany("management_company");
      c = await seedCompany("self_managed_owner");
    });
    it("AC-5 IN21 owner creation commits one version and event with a valid chain", async () => {
      const before = await countEvents(a, "owner.created");
      const response = await request(app, a, {
        method: "POST",
        body: synthetic,
        key,
      });
      expect(response.status).toBe(201);
      first = response;
      const record = ownerSummarySchema.parse(response.body.owner);
      owner = record.id;
      ownerVersion = record.version;
      expect(record.version).toBe(1);
      expect(await countEvents(a, "owner.created")).toBe(before + 1);
      const events = await query(
        a,
        "select version_after from audit.audit_event where company_id=:c and subject_id=:id and event_type='owner.created'",
        [uuid("id", owner)],
      );
      expect(Number(events[0]?.version_after)).toBe(1);
      expect(await verifyChain(a)).toBe(true);
    });
    it("D02 history occurredAt is within 120 seconds of the UTC clock", async () => {
      const detail = ownerDetailSchema.parse(
        (await request(app, a, { path: `/${owner}` })).body,
      );
      const entry = detail.history.find(
        (item) => item.eventType === "owner.created",
      );
      expect(entry).toBeDefined();
      expect(
        Math.abs(Date.parse(entry?.occurredAt ?? "") - Date.now()),
      ).toBeLessThan(120000);
    });
    it("AC-6 IN4 replay is exact and a changed request is denied once", async () => {
      const before = await countEvents(a, "owner.created");
      expect(
        await request(app, a, { method: "POST", body: synthetic, key }),
      ).toEqual(first);
      expect(await countEvents(a, "owner.created")).toBe(before);
      const denied = await countEvents(a, "policy.denied");
      const response = await request(app, a, {
        method: "POST",
        body: { ...synthetic, preferredLanguage: "ar" },
        key,
      });
      expect(response.status).toBe(422);
      expect(response.body.code).toBe("IDEMPOTENCY_KEY_REUSED");
      expect(await countEvents(a, "policy.denied")).toBe(denied + 1);
    });
    it("D01 AC-7 IN1 cross-company reads and edits reveal nothing and record one denial", async () => {
      const snapshot = await query(
        a,
        "select version,phone_e164 from party.owner where company_id=:c and id=:id",
        [uuid("id", owner)],
      );
      for (const company of [a, b])
        for (const method of ["GET", "PATCH"]) {
          const before = await countEvents(company, "policy.denied");
          const response = await request(app, company, {
            account: b.manager,
            path: `/${owner}`,
            method,
            ...(method === "PATCH"
              ? {
                  body: {
                    expectedVersion: ownerVersion,
                    phoneE164: "+971500000001",
                  },
                }
              : {}),
          });
          expect(response.status).toBe(404);
          expect(response.body.code).toBe("NOT_FOUND");
          expect(await countEvents(company, "policy.denied")).toBe(before + 1);
          if (method === "GET") {
            const denial = await query(
              company,
              "select policy_decision from audit.audit_event where company_id=:c and trace_id=:trace and event_type='policy.denied'",
              [param("trace", String(response.body.traceId))],
            );
            expect(denial).toHaveLength(1);
            expect(JSON.parse(String(denial[0]?.policy_decision))).toEqual({
              policy_version: "estate-1",
              result: "deny",
              reasons: ["NOT_FOUND", "command:owner.read"],
            });
          }
        }
      expect(
        await query(
          a,
          "select version,phone_e164 from party.owner where company_id=:c and id=:id",
          [uuid("id", owner)],
        ),
      ).toEqual(snapshot);
      const unknown = { ...a, id: randomUUID() };
      expect((await request(app, unknown)).status).toBe(404);
    });
    it("AC-8 IN3 IN4 only managers create owners and owners see their own record", async () => {
      for (const role of [
        "admin",
        "accountant",
        "tenant",
        "owner",
        "technician",
      ]) {
        const before = await countEvents(a, "policy.denied");
        const response = await request(app, a, {
          method: "POST",
          body: synthetic,
          account: a.accounts[role],
        });
        expect(response.status).toBe(403);
        expect(await countEvents(a, "policy.denied")).toBe(before + 1);
      }
      const list = await request(app, a, { account: a.accounts.owner });
      expect(list.status).toBe(200);
      expect(list.body.items).toEqual([
        expect.objectContaining({ id: a.owner }),
      ]);
      const before = await countEvents(a, "policy.denied");
      expect(
        (
          await request(app, a, {
            path: `/${owner}`,
            account: a.accounts.owner,
          })
        ).status,
      ).toBe(404);
      expect(await countEvents(a, "policy.denied")).toBe(before + 1);
      const detail = await request(app, a, {
        path: `/${a.owner}`,
        account: a.accounts.owner,
      });
      expect(ownerDetailSchema.parse(detail.body).history).toEqual([]);
    });
    it("AC-9 IN4 IN21 owner stale versions refuse without mutation", async () => {
      const response = await request(app, a, {
        path: `/${owner}`,
        method: "PATCH",
        body: { expectedVersion: ownerVersion, phoneE164: "+971500000002" },
      });
      expect(response.status).toBe(200);
      ownerVersion = ownerSummarySchema.parse(response.body.owner).version;
      const before = await countEvents(a, "policy.denied");
      const denied = await request(app, a, {
        path: `/${owner}`,
        method: "PATCH",
        body: { expectedVersion: 1, phoneE164: "+971500000003" },
      });
      expect(denied.status).toBe(409);
      expect(denied.body.code).toBe("VERSION_CONFLICT");
      expect(await countEvents(a, "policy.denied")).toBe(before + 1);
      const detail = await request(app, a, { path: `/${owner}` });
      expect(detail.body.phoneE164).toBe("+971500000002");
      expect(detail.body.version).toBe(ownerVersion);
    });
    it("AC-9 AC-10 IN4 mandate versions, ownership and changed owner approval require evidence", async () => {
      const body = {
        expectedVersion: null,
        ownerGate: false,
        costThresholdFils: "500000",
        startsOn: "2026-01-01",
        endsOn: null,
        propertyIds: [],
      };
      const response = await request(app, a, {
        path: `/${owner}/mandate`,
        method: "PUT",
        body,
      });
      expect(response.status).toBe(200);
      const mandate = mandateDetailSchema.parse(response.body.mandate);
      const stale = await request(app, a, {
        path: `/${owner}/mandate`,
        method: "PUT",
        body,
      });
      expect(stale.status).toBe(409);
      const denied = await request(app, a, {
        path: `/${owner}/mandate`,
        method: "PUT",
        body: { ...body, expectedVersion: mandate.version, ownerGate: true },
      });
      expect(denied.status).toBe(422);
      expect(denied.body.code).toBe("REASON_REQUIRED");
      const foreign = await request(app, a, {
        path: `/${owner}/mandate`,
        method: "PUT",
        body: {
          ...body,
          expectedVersion: mandate.version,
          propertyIds: [randomUUID()],
        },
      });
      expect(foreign.status).toBe(422);
      expect(foreign.body.code).toBe("PROPERTY_NOT_OWNED");
      const detail = ownerDetailSchema.parse(
        (await request(app, a, { path: `/${owner}` })).body,
      );
      expect(detail.ownerGate).toEqual({
        value: false,
        recorded: true,
        source: "mandate",
      });
    });
    it("AC-11 IN21 self-managed owner links the account once and switches the gate off", async () => {
      const result = await request(app, c, {
        method: "POST",
        body: { ...synthetic, selfManaged: true },
      });
      expect(result.status).toBe(201);
      const self = ownerSummarySchema.parse(result.body.owner);
      expect(self.linked).toBe(true);
      const links = await query(
        c,
        "select id from core.account_company_link where company_id=:c and account_id=:a and kind='owner' and status='active'",
        [uuid("a", c.manager)],
      );
      expect(links).toHaveLength(1);
      const detail = ownerDetailSchema.parse(
        (await request(app, c, { path: `/${self.id}` })).body,
      );
      expect(detail.ownerGate).toEqual({
        value: false,
        recorded: false,
        source: "self_managed",
      });
      const duplicate = await request(app, c, {
        method: "POST",
        body: { ...synthetic, selfManaged: true },
      });
      expect(duplicate.status).toBe(422);
      expect(duplicate.body.code).toBe("SELF_MANAGED_OWNER_EXISTS");
      const wrong = await request(app, a, {
        method: "POST",
        body: { ...synthetic, selfManaged: true },
      });
      expect(wrong.status).toBe(422);
      expect(wrong.body.code).toBe("SELF_MANAGED_NOT_ALLOWED");
    });
    it("IN4 owners only edit phone and language and accountants can write bank details", async () => {
      const own = await request(app, a, {
        path: `/${a.owner}`,
        method: "PATCH",
        account: a.accounts.owner,
        body: { expectedVersion: 1, preferredLanguage: "ar" },
      });
      expect(own.status).toBe(200);
      const refusal = await request(app, a, {
        path: `/${a.owner}`,
        method: "PATCH",
        account: a.accounts.owner,
        body: { expectedVersion: 2, email: "synthetic-other@example.com" },
      });
      expect(refusal.status).toBe(403);
      const body = {
        expectedVersion: ownerVersion,
        bankName: "Synthetic bank",
        accountHolder: "Synthetic individual",
        iban: "AE070331234567890123456",
      };
      const result = await request(app, a, {
        path: `/${owner}/bank-details`,
        method: "PUT",
        account: a.accounts.accountant,
        body,
      });
      expect(result.status).toBe(200);
      const detail = ownerDetailSchema.parse(
        (await request(app, a, { path: `/${owner}` })).body,
      );
      expect(detail.bank?.ibanLast4).toBe("3456");
      const events = await query(
        a,
        "select changed_fields from audit.audit_event where company_id=:c and subject_id=:id and event_type=:type order by seq desc limit 1",
        [uuid("id", owner), param("type", "owner.updated")],
      );
      expect(JSON.parse(String(events[0]?.changed_fields))).toEqual([
        "bank_name",
        "account_holder",
        "iban",
      ]);
    });
    it("IN21 all phase A company chains verify", async () => {
      for (const company of [a, b, c])
        expect(await verifyChain(company)).toBe(true);
    });
    it("D01 every recorded denial matches the shared policy schema and every final chain verifies", async () => {
      let count = 0;
      for (const company of [a, b, c]) {
        count += await validateDenials(company);
        expect(await verifyChain(company)).toBe(true);
      }
      expect(count).toBeGreaterThan(0);
    });
  },
);
