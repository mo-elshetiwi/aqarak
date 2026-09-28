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
} from "../properties/lib/schemas";
import { invitationResponseSchema } from "./invitation";
import { uuid } from "../properties/lib/sql";
const app = integrationApp();
describe.runIf(Boolean(estateConfig().clusterArn))(
  "Owner invitation live acceptance",
  () => {
    let a: SyntheticCompany;
    let b: SyntheticCompany;
    let c: SyntheticCompany;
    beforeAll(async () => {
      a = await seedCompany("management_company");
      b = await seedCompany("management_company");
      c = await seedCompany("self_managed_owner");
    });
    it("D02 AC-15 IN21 invitation and outbox share one covering event and seven-day expiry", async () => {
      const owner = ownerSummarySchema.parse(
        (
          await request(app, a, {
            method: "POST",
            body: {
              fullName: {
                en: "Synthetic invited owner",
                ar: "مالك تجريبي مدعو",
              },
              email: "SYNTHETIC-INVITED@example.com",
              preferredLanguage: "en",
            },
          })
        ).body.owner,
      );
      const before = await countEvents(a, "invitation.created");
      const start = Date.now();
      const response = await request(app, a, {
        path: `/${owner.id}/invitation`,
        method: "POST",
        body: {},
      });
      expect(response.status).toBe(201);
      const invitation = invitationResponseSchema.parse(
        response.body,
      ).invitation;
      expect(Date.parse(invitation.expiresAt) - start).toBeGreaterThan(
        7 * 86400000 - 1000,
      );
      expect(Date.parse(invitation.expiresAt) - Date.now()).toBeLessThanOrEqual(
        7 * 86400000,
      );
      const detail = ownerDetailSchema.parse(
        (await request(app, a, { path: `/${owner.id}` })).body,
      );
      expect(detail.invitation?.expiresAt).toBe(invitation.expiresAt);
      const stored = await query(
        a,
        "select status,email,expires_at from core.invitation where company_id=:c and id=:id",
        [uuid("id", invitation.id)],
      );
      expect(stored).toHaveLength(1);
      expect(stored[0]?.status).toBe("pending");
      expect(stored[0]?.email === "synthetic-invited@example.com").toBe(true);
      const outbox = await query(
        a,
        "select v.subject_id,s.event_id from audit.entity_version v join audit.event_subject s on s.company_id=v.company_id and s.subject_type=v.subject_type and s.subject_id=v.subject_id and s.subject_version=v.subject_version join audit.audit_event e on e.company_id=s.company_id and e.event_id=s.event_id where v.company_id=:c and v.subject_type='outbox' and v.subject_version=1 and v.snapshot->>'topic'='invitation.email' and v.snapshot->'payload'->>'invitationId'=cast(:id as text) and e.subject_id=:id and e.event_type='invitation.created' and e.tx_id=v.tx_id",
        [uuid("id", invitation.id)],
      );
      expect(outbox).toHaveLength(1);
      expect(await countEvents(a, "invitation.created")).toBe(before + 1);
      expect(await verifyChain(a)).toBe(true);
      const denied = await countEvents(a, "policy.denied");
      const repeat = await request(app, a, {
        path: `/${owner.id}/invitation`,
        method: "POST",
        body: {},
      });
      expect(repeat.status).toBe(409);
      expect(repeat.body.code).toBe("INVITATION_PENDING");
      expect(await countEvents(a, "policy.denied")).toBe(denied + 1);
    });
    it("AC-15 IN4 linked owners and owners without email refuse invitation", async () => {
      const body = {
        fullName: { en: "Synthetic self owner", ar: "مالك ذاتي تجريبي" },
        preferredLanguage: "en",
      };
      const linked = ownerSummarySchema.parse(
        (
          await request(app, c, {
            method: "POST",
            body: { ...body, selfManaged: true },
          })
        ).body.owner,
      );
      const response = await request(app, c, {
        path: `/${linked.id}/invitation`,
        method: "POST",
        body: { email: "synthetic-linked@example.com" },
      });
      expect(response.status).toBe(422);
      expect(response.body.code).toBe("OWNER_ALREADY_LINKED");
      const noEmail = ownerSummarySchema.parse(
        (await request(app, b, { method: "POST", body })).body.owner,
      );
      const missing = await request(app, b, {
        path: `/${noEmail.id}/invitation`,
        method: "POST",
        body: {},
      });
      expect(missing.status).toBe(422);
      expect(missing.body.code).toBe("OWNER_EMAIL_REQUIRED");
    });
    it("AC-16 IN21 final chains for companies A, B and C all return ok", async () => {
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
