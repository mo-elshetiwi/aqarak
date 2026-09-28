import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  createHarness,
  seedHarness,
  newTenant,
  linkTenant,
  eventCount,
  uploadFixture,
  reviewAll,
  record,
  query,
} from "./integration-support";

describe.skipIf(process.env.J3_DEV_DATABASE !== "1")(
  "Company-only collection permissions",
  () => {
    it("linked tenants receive 403 for collection listing and tenant creation with one denial each", async () => {
      const h = createHarness();
      await seedHarness(h);
      const tenant = await newTenant(h);
      await linkTenant(h, z.string().parse(tenant.id));
      const before = await eventCount(h, "policy.denied", h.tenantAccount);
      const path = `/v1/companies/${h.companyA}/tenants`;
      const listed = await h.request(h.tenantAccount, "GET", path);
      expect(listed.status).toBe(403);
      expect(listed.body.code).toBe("FORBIDDEN");
      const created = await h.request(h.tenantAccount, "POST", path, {
        kind: "individual",
        fullNameEn: "Synthetic Refused",
        email: "j3-refused@example.com",
        preferredLanguage: "en",
      });
      expect(created.status).toBe(403);
      expect(created.body.code).toBe("FORBIDDEN");
      expect(await eventCount(h, "policy.denied", h.tenantAccount)).toBe(
        before + 2,
      );
      const linkedInvitation = await h.request(
        h.managerA,
        "POST",
        `${path}/${z.string().parse(tenant.id)}/invitations`,
      );
      expect(linkedInvitation.status).toBe(409);
      expect(linkedInvitation.body.code).toBe("ALREADY_LINKED");
    }, 180_000);
    it("clean unsupported PDF permits manual save and a later rejected version records its reason", async () => {
      const h = createHarness();
      await seedHarness(h);
      const tenant = await newTenant(h);
      const tenantId = z.string().parse(tenant.id);
      const invitationPath = `/v1/companies/${h.companyA}/tenants/${tenantId}/invitations`;
      expect((await h.request(h.managerA, "POST", invitationPath)).status).toBe(
        201,
      );
      const duplicateInvitation = await h.request(
        h.managerA,
        "POST",
        invitationPath,
      );
      expect(duplicateInvitation.status).toBe(409);
      expect(duplicateInvitation.body.code).toBe("INVITATION_PENDING");
      const fixture = await uploadFixture(h, tenantId, true, {
        bytes: new TextEncoder().encode(
          "%PDF-1.4\n% Synthetic unsupported-format fixture\n%%EOF\n",
        ),
        contentType: "application/pdf",
        fileName: "synthetic-unsupported.pdf",
      });
      const extraction = await h.request(
        h.managerA,
        "POST",
        `${fixture.path}/extraction`,
      );
      expect(extraction.status).toBe(422);
      expect(extraction.body.code).toBe("UNSUPPORTED_FOR_EXTRACTION");
      const version = record(
        (await h.request(h.managerA, "GET", fixture.path)).body,
        "version",
      );
      expect(version.processingStatus).toBe("extraction_failed");
      expect(version.modelCall).toBeNull();
      expect(h.calls).toBe(0);
      await reviewAll(h, fixture, true);
      const saved = await h.request(
        h.managerA,
        "POST",
        `/v1/companies/${h.companyA}/tenants/${tenantId}/identity`,
        { documentVersionId: fixture.versionId, expectedTenantVersion: 1 },
      );
      expect(saved.status).toBe(200);
      expect(record(saved.body, "tenant").identityStatus).toBe("verified");
      const next = await uploadFixture(h, tenantId, false);
      const rejected = await h.request(
        h.managerA,
        "POST",
        `${next.path}/reject`,
        { reason: "wrong_type", note: "Synthetic review rejection" },
      );
      expect(rejected.status).toBe(200);
      expect(record(rejected.body, "version")).toMatchObject({
        reviewStatus: "rejected",
        rejectReason: "wrong_type: Synthetic review rejection",
      });
      expect(
        (
          await query(
            h,
            `select * from audit.verify_chain(cast(:company as uuid))`,
          )
        )[0]?.ok,
      ).toBe(true);
    }, 180_000);
  },
);
