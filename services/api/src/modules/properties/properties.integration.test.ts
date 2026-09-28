import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { estateConfig } from "./lib/config";
import {
  integrationApp,
  seedCompany,
  seedTenantContract,
  request,
  query,
  countEvents,
  verifyChain,
  validateDenials,
  type SyntheticCompany,
} from "./lib/integration-fixture";
import { ownerSummarySchema, mandateDetailSchema } from "./lib/schemas";
import {
  propertySummarySchema,
  propertyDetailSchema,
  unitItemSchema,
} from "./schemas";
import { uuid } from "./lib/sql";
const app = integrationApp();
const syntheticOwner = {
  fullName: { en: "Synthetic property owner", ar: "مالك عقار تجريبي" },
  preferredLanguage: "en",
};
describe.runIf(Boolean(estateConfig().clusterArn))(
  "Properties live Data API acceptance",
  () => {
    let a: SyntheticCompany;
    let c: SyntheticCompany;
    let owner: string;
    let property: string;
    let unit: string;
    let propertyVersion = 1;
    let unitVersion = 1;
    beforeAll(async () => {
      a = await seedCompany("management_company", [
        "owner",
        "tenant",
        "technician",
      ]);
      c = await seedCompany("self_managed_owner");
      owner = ownerSummarySchema.parse(
        (await request(app, a, { method: "POST", body: syntheticOwner })).body
          .owner,
      ).id;
    });
    it("AC-10 IN21 property creation commits representative ownership and defaults owner approval on", async () => {
      const response = await request(app, a, {
        root: "properties",
        method: "POST",
        body: {
          name: { en: "Synthetic property", ar: "عقار تجريبي" },
          kind: "building",
          use: "residential",
          ownerId: owner,
          ownerGateOverride: null,
          prpNumber: "SYNTHETIC-1",
        },
      });
      expect(response.status).toBe(201);
      property = propertySummarySchema.parse(response.body.property).id;
      const ownership = await query(
        a,
        "select share_bp,is_representative from estate.ownership where company_id=:c and property_id=:id",
        [uuid("id", property)],
      );
      expect(ownership).toHaveLength(1);
      expect(Number(ownership[0]?.share_bp)).toBe(10000);
      expect(ownership[0]?.is_representative).toBe(true);
      const detail = propertyDetailSchema.parse(
        (await request(app, a, { root: "properties", path: `/${property}` }))
          .body,
      );
      expect(detail.ownerGate).toEqual({
        value: true,
        source: "company_default",
      });
    });
    it("AC-10 IN4 mandate coverage chooses owner approval and override changes require a reason", async () => {
      const result = await request(app, a, {
        path: `/${owner}/mandate`,
        method: "PUT",
        body: {
          expectedVersion: null,
          ownerGate: false,
          costThresholdFils: "100000",
          startsOn: "2026-01-01",
          endsOn: null,
          propertyIds: [property],
        },
      });
      expect(result.status).toBe(200);
      const mandate = mandateDetailSchema.parse(result.body.mandate);
      expect(
        propertyDetailSchema.parse(
          (await request(app, a, { root: "properties", path: `/${property}` }))
            .body,
        ).ownerGate,
      ).toEqual({ value: false, source: "mandate" });
      const before = await countEvents(a, "policy.denied");
      const refused = await request(app, a, {
        root: "properties",
        path: `/${property}`,
        method: "PATCH",
        body: { expectedVersion: 1, ownerGateOverride: true },
      });
      expect(refused.status).toBe(422);
      expect(refused.body.code).toBe("REASON_REQUIRED");
      expect(await countEvents(a, "policy.denied")).toBe(before + 1);
      const changed = await request(app, a, {
        root: "properties",
        path: `/${property}`,
        method: "PATCH",
        body: {
          expectedVersion: 1,
          ownerGateOverride: true,
          reason: "Synthetic owner approval change",
        },
      });
      expect(changed.status).toBe(200);
      propertyVersion = propertySummarySchema.parse(
        changed.body.property,
      ).version;
      const detail = propertyDetailSchema.parse(
        (await request(app, a, { root: "properties", path: `/${property}` }))
          .body,
      );
      expect(detail.ownerGate).toEqual({
        value: true,
        source: "property_override",
      });
      expect(
        detail.history.some(
          (entry) => entry.reason === "Synthetic owner approval change",
        ),
      ).toBe(true);
      const removed = await request(app, a, {
        path: `/${owner}/mandate`,
        method: "PUT",
        body: {
          expectedVersion: mandate.version,
          ownerGate: false,
          costThresholdFils: "100000",
          startsOn: "2026-01-01",
          endsOn: null,
          propertyIds: [],
        },
      });
      expect(removed.status).toBe(200);
      expect(
        (
          await query(
            a,
            "select status from estate.mandate_property where company_id=:c and mandate_id=:id",
            [uuid("id", mandate.id)],
          )
        )[0]?.status,
      ).toBe("removed");
    });
    it("AC-12 IN21 bulk units start vacant and duplicate requests are atomic", async () => {
      const before = await countEvents(a, "unit.created");
      const response = await request(app, a, {
        root: "properties",
        path: `/${property}/units`,
        method: "POST",
        body: {
          units: [
            {
              unitNo: "S-1",
              untNumber: "SYNTHETIC-UNT-1",
              use: "residential",
              kind: "apartment",
              areaSqm: "80.50",
            },
            { unitNo: "S-2", use: "residential", kind: "apartment" },
          ],
        },
      });
      expect(response.status).toBe(201);
      const units = z.array(unitItemSchema).parse(response.body.units);
      expect(units.every((item) => item.status === "vacant")).toBe(true);
      expect(await countEvents(a, "unit.created")).toBe(before + 2);
      unit = units[0]?.id ?? "";
      const duplicate = await request(app, a, {
        root: "properties",
        path: `/${property}/units`,
        method: "POST",
        body: {
          units: [
            { unitNo: "S-3", use: "commercial", kind: "office" },
            { unitNo: "S-3", use: "commercial", kind: "office" },
          ],
        },
      });
      expect(duplicate.status).toBe(422);
      expect(duplicate.body.field).toBe("units[1].unitNo");
      expect(await countEvents(a, "unit.created")).toBe(before + 2);
      expect(
        await query(
          a,
          "select id from estate.unit where company_id=:c and property_id=:id",
          [uuid("id", property)],
        ),
      ).toHaveLength(2);
    });
    it("AC-13 IN4 IN21 manual status commands follow the domain transition and retain reason", async () => {
      const path = `/${property}/units/${unit}/status`;
      const blocked = await request(app, a, {
        root: "properties",
        path,
        method: "POST",
        body: {
          expectedVersion: unitVersion,
          command: "block",
          blockReason: "sale",
          reason: "Synthetic sale restriction",
        },
      });
      expect(blocked.status).toBe(200);
      const block = unitItemSchema.parse(blocked.body.unit);
      expect(block.status).toBe("blocked");
      expect(block.blockReason).toBe("sale");
      unitVersion = block.version;
      const unblocked = await request(app, a, {
        root: "properties",
        path,
        method: "POST",
        body: {
          expectedVersion: unitVersion,
          command: "unblock",
          reason: "Synthetic restriction ended",
        },
      });
      expect(unblocked.status).toBe(200);
      const open = unitItemSchema.parse(unblocked.body.unit);
      expect(open.status).toBe("vacant");
      expect(open.blockReason).toBeNull();
      unitVersion = open.version;
      const before = await countEvents(a, "policy.denied");
      const wrong = await request(app, a, {
        root: "properties",
        path,
        method: "POST",
        body: {
          expectedVersion: unitVersion,
          command: "delist",
          reason: "Synthetic invalid transition",
        },
      });
      expect(wrong.status).toBe(409);
      expect(wrong.body.code).toBe("INVALID_TRANSITION");
      expect(await countEvents(a, "policy.denied")).toBe(before + 1);
      for (const body of [
        {
          expectedVersion: unitVersion,
          command: "move_in",
          reason: "Synthetic contract action",
        },
        { expectedVersion: unitVersion, command: "list" },
      ])
        expect(
          (
            await request(app, a, {
              root: "properties",
              path,
              method: "POST",
              body,
            })
          ).status,
        ).toBe(400);
      const events = await query(
        a,
        "select reason from audit.audit_event where company_id=:c and subject_id=:id and event_type='unit.blocked'",
        [uuid("id", unit)],
      );
      expect(events[0]?.reason).toBe("Synthetic sale restriction");
    });
    it("AC-9 IN4 stale property and unit commands each leave one denial and unchanged versions", async () => {
      for (const change of [
        {
          path: `/${property}`,
          body: { expectedVersion: 1, zone: "Synthetic zone" },
        },
        {
          path: `/${property}/units/${unit}`,
          body: { expectedVersion: 1, unitNo: "S-stale" },
        },
      ]) {
        const before = await countEvents(a, "policy.denied");
        const response = await request(app, a, {
          root: "properties",
          method: "PATCH",
          ...change,
        });
        expect(response.status).toBe(409);
        expect(response.body.code).toBe("VERSION_CONFLICT");
        expect(await countEvents(a, "policy.denied")).toBe(before + 1);
      }
      const detail = propertyDetailSchema.parse(
        (await request(app, a, { root: "properties", path: `/${property}` }))
          .body,
      );
      expect(detail.version).toBe(propertyVersion);
      expect(detail.units.find((item) => item.id === unit)?.version).toBe(
        unitVersion,
      );
    });
    it("AC-11 self-managed company property owner approval stays off despite an override", async () => {
      const created = await request(app, c, {
        method: "POST",
        body: { ...syntheticOwner, selfManaged: true },
      });
      const self = ownerSummarySchema.parse(created.body.owner);
      const response = await request(app, c, {
        root: "properties",
        method: "POST",
        body: {
          name: { en: "Synthetic self property", ar: "عقار ذاتي تجريبي" },
          kind: "villa",
          use: "residential",
          ownerId: self.id,
          ownerGateOverride: true,
        },
      });
      expect(response.status).toBe(201);
      const id = propertySummarySchema.parse(response.body.property).id;
      expect(
        propertyDetailSchema.parse(
          (await request(app, c, { root: "properties", path: `/${id}` })).body,
        ).ownerGate,
      ).toEqual({ value: false, source: "self_managed" });
    });
    it("IN1 IN3 IN4 property scopes deny unrelated owners and technicians", async () => {
      const before = await countEvents(a, "policy.denied");
      expect(
        (
          await request(app, a, {
            root: "properties",
            path: `/${property}`,
            account: a.accounts.owner,
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await request(app, a, {
            root: "properties",
            account: a.accounts.technician,
          })
        ).status,
      ).toBe(403);
      expect(await countEvents(a, "policy.denied")).toBe(before + 2);
      expect(
        (
          await request(app, a, {
            root: "properties",
            account: a.accounts.tenant,
          })
        ).body.items,
      ).toEqual([]);
      const unknown = await request(app, a, {
        root: "properties",
        method: "POST",
        body: {
          name: { en: "Synthetic unknown owner", ar: "مالك تجريبي مجهول" },
          kind: "plot",
          use: "mixed",
          ownerId: randomUUID(),
          ownerGateOverride: null,
        },
      });
      expect(unknown.status).toBe(422);
      expect(unknown.body.code).toBe("OWNER_NOT_FOUND");
      expect(await verifyChain(a)).toBe(true);
      expect(await verifyChain(c)).toBe(true);
    });
    it("IN3 owners see owned properties and tenants see only properties reached through their contracts", async () => {
      const created = await request(app, a, {
        root: "properties",
        method: "POST",
        body: {
          name: { en: "Synthetic linked property", ar: "عقار مرتبط تجريبي" },
          kind: "villa",
          use: "residential",
          ownerId: a.owner,
          ownerGateOverride: null,
        },
      });
      expect(created.status).toBe(201);
      const owned = propertySummarySchema.parse(created.body.property);
      expect(
        (
          await request(app, a, {
            root: "properties",
            path: `/${owned.id}`,
            account: a.accounts.owner,
          })
        ).status,
      ).toBe(200);
      const ownerList = await request(app, a, {
        root: "properties",
        account: a.accounts.owner,
      });
      expect(ownerList.body.items).toEqual([
        expect.objectContaining({ id: owned.id }),
      ]);
      expect(
        (
          await request(app, a, {
            root: "properties",
            path: `/${property}`,
            account: a.accounts.tenant,
          })
        ).status,
      ).toBe(404);
      await seedTenantContract(a, unit);
      expect(
        (
          await request(app, a, {
            root: "properties",
            path: `/${property}`,
            account: a.accounts.tenant,
          })
        ).status,
      ).toBe(200);
      const tenantList = await request(app, a, {
        root: "properties",
        account: a.accounts.tenant,
      });
      expect(tenantList.body.items).toEqual([
        expect.objectContaining({ id: property }),
      ]);
      expect(
        (
          await request(app, a, {
            root: "properties",
            path: `/${owned.id}`,
            account: a.accounts.tenant,
          })
        ).status,
      ).toBe(404);
      expect(await verifyChain(a)).toBe(true);
    });
    it("IN4 PRP and unit identifiers are unique and unit edits retain optimistic versions", async () => {
      const duplicateProperty = await request(app, a, {
        root: "properties",
        method: "POST",
        body: {
          name: { en: "Synthetic duplicate property", ar: "عقار تجريبي مكرر" },
          kind: "building",
          use: "residential",
          ownerId: owner,
          ownerGateOverride: null,
          prpNumber: "SYNTHETIC-1",
        },
      });
      expect(duplicateProperty.status).toBe(422);
      expect(duplicateProperty.body.code).toBe("PRP_NUMBER_TAKEN");
      for (const example of [
        { unitNo: "S-1", code: "UNIT_NUMBER_TAKEN", field: "units[0].unitNo" },
        {
          unitNo: "S-3",
          untNumber: "SYNTHETIC-UNT-1",
          code: "UNT_NUMBER_TAKEN",
          field: "units[0].untNumber",
        },
      ]) {
        const response = await request(app, a, {
          root: "properties",
          method: "POST",
          path: `/${property}/units`,
          body: {
            units: [
              {
                unitNo: example.unitNo,
                ...("untNumber" in example
                  ? { untNumber: example.untNumber }
                  : {}),
                use: "residential",
                kind: "apartment",
              },
            ],
          },
        });
        expect(response.status).toBe(422);
        expect(response.body.code).toBe(example.code);
        expect(response.body.field).toBe(example.field);
      }
      const duplicateUnit = await request(app, a, {
        root: "properties",
        method: "PATCH",
        path: `/${property}/units/${unit}`,
        body: { expectedVersion: unitVersion, unitNo: "S-2" },
      });
      expect(duplicateUnit.status).toBe(422);
      expect(duplicateUnit.body.code).toBe("UNIT_NUMBER_TAKEN");
      const edited = await request(app, a, {
        root: "properties",
        method: "PATCH",
        path: `/${property}/units/${unit}`,
        body: { expectedVersion: unitVersion, bedrooms: 2, areaSqm: "85.25" },
      });
      expect(edited.status).toBe(200);
      const changed = unitItemSchema.parse(edited.body.unit);
      expect(changed.version).toBe(unitVersion + 1);
      expect(changed.bedrooms).toBe(2);
      expect(changed.areaSqm).toBe("85.25");
      expect(await verifyChain(a)).toBe(true);
    });
    it("D01 every recorded denial matches the shared policy schema and every final chain verifies", async () => {
      let count = 0;
      for (const company of [a, c]) {
        count += await validateDenials(company);
        expect(await verifyChain(company)).toBe(true);
      }
      expect(count).toBeGreaterThan(0);
    });
  },
);
