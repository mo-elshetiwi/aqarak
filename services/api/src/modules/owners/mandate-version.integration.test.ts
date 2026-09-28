import { describe, expect, it } from "vitest";
import { estateConfig } from "../properties/lib/config";
import {
  integrationApp,
  seedCompany,
  request,
  query,
  countEvents,
  verifyChain,
  validateDenials,
} from "../properties/lib/integration-fixture";
import {
  ownerSummarySchema,
  mandateDetailSchema,
} from "../properties/lib/schemas";
import { uuid } from "../properties/lib/sql";
const app = integrationApp();
describe.runIf(Boolean(estateConfig().clusterArn))(
  "Mandate numeric entity version acceptance",
  () => {
    it("D01 AC-9 IN4 IN21 a stale numeric mandate version changes nothing and records one denial", async () => {
      const company = await seedCompany("management_company");
      const owner = ownerSummarySchema.parse(
        (
          await request(app, company, {
            method: "POST",
            body: {
              fullName: {
                en: "Synthetic version owner",
                ar: "مالك نسخة تجريبي",
              },
              preferredLanguage: "en",
            },
          })
        ).body.owner,
      );
      const body = {
        expectedVersion: null,
        ownerGate: false,
        costThresholdFils: "9007199254740993",
        startsOn: "2026-01-01",
        endsOn: null,
        propertyIds: [],
      };
      const created = await request(app, company, {
        path: `/${owner.id}/mandate`,
        method: "PUT",
        body,
      });
      expect(created.status).toBe(200);
      const initial = mandateDetailSchema.parse(created.body.mandate);
      const reason = "Synthetic changed owner approval choice";
      const updated = await request(app, company, {
        path: `/${owner.id}/mandate`,
        method: "PUT",
        body: {
          ...body,
          expectedVersion: initial.version,
          ownerGate: true,
          reason,
        },
      });
      expect(updated.status).toBe(200);
      const current = mandateDetailSchema.parse(updated.body.mandate);
      expect(current.version).toBe(initial.version + 1);
      expect(current.costThresholdFils).toBe(body.costThresholdFils);
      const before = await countEvents(company, "policy.denied");
      const stale = await request(app, company, {
        path: `/${owner.id}/mandate`,
        method: "PUT",
        body: { ...body, expectedVersion: initial.version, reason },
      });
      expect(stale.status).toBe(409);
      expect(stale.body.code).toBe("VERSION_CONFLICT");
      expect(await countEvents(company, "policy.denied")).toBe(before + 1);
      const stored = await query(
        company,
        "select version,owner_gate,cost_threshold_fils from estate.owner_mandate where company_id=:c and id=:id",
        [uuid("id", current.id)],
      );
      expect(Number(stored[0]?.version)).toBe(current.version);
      expect(stored[0]?.owner_gate).toBe(true);
      expect(stored[0]?.cost_threshold_fils).toBe(body.costThresholdFils);
      const changes = await query(
        company,
        "select reason from audit.audit_event where company_id=:c and subject_id=:id and event_type='owner_mandate.updated'",
        [uuid("id", current.id)],
      );
      expect(changes).toHaveLength(1);
      expect(changes[0]?.reason).toBe(reason);
      expect(await validateDenials(company)).toBe(1);
      expect(await verifyChain(company)).toBe(true);
    });
  },
);
