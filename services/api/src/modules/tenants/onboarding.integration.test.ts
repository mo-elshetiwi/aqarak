import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createHarness,
  seedHarness,
  newTenant,
  uploadFixture,
  extractFixture,
  reviewAll,
  record,
  eventCount,
  linkTenant,
  query,
  type IntegrationHarness,
  type UploadFixture,
} from "./integration-support";
import { num, one, rows } from "../documents/sql";
import { appendAuditEvent } from "../documents/audit";

const enabled = process.env.J3_DEV_DATABASE === "1";
describe.skipIf(!enabled)(
  "Tenant onboarding against aqarak_tenants (synthetic fixtures)",
  () => {
    let h: IntegrationHarness;
    let journey: UploadFixture;
    let pending: UploadFixture;
    let tenantId: string;
    let tenantVersion: number;
    beforeAll(async () => {
      h = createHarness();
      await seedHarness(h);
    }, 180_000);
    it("I-1 manager creates, invites, uploads, scans, extracts, reviews and saves with a valid audit chain", async () => {
      const tenant = await newTenant(h);
      tenantId = z.string().parse(tenant.id);
      tenantVersion = z.number().parse(tenant.version);
      const invitation = await h.request(
        h.managerA,
        "POST",
        `/v1/companies/${h.companyA}/tenants/${tenantId}/invitations`,
      );
      expect(invitation.status).toBe(201);
      expect(record(invitation.body, "invitation").status).toBe("pending");
      expect(JSON.stringify(invitation.body)).not.toContain("token");
      journey = await uploadFixture(h, tenantId);
      const extracted = await extractFixture(h, journey);
      expect(extracted.processingStatus).toBe("extracted");
      expect(z.array(z.unknown()).parse(extracted.fields)).toHaveLength(10);
      const view = await h.request(
        h.managerA,
        "GET",
        `${journey.path}/content`,
      );
      expect(view.status).toBe(200);
      expect(view.headers.get("cache-control")).toBe("no-store");
      expect(
        new URL(z.string().parse(view.body.url)).searchParams.has("versionId"),
      ).toBe(true);
      await reviewAll(h, journey);
      const saved = await h.request(
        h.managerA,
        "POST",
        `/v1/companies/${h.companyA}/tenants/${tenantId}/identity`,
        {
          documentVersionId: journey.versionId,
          expectedTenantVersion: tenantVersion,
        },
      );
      expect(saved.status).toBe(200);
      expect(record(saved.body, "tenant")).toMatchObject({
        fullNameEn: "Synthetic Reviewed Name",
        fullNameAr: "مستأجر تجريبي",
        eidNumber: "784197848291635",
        eidMasked: "784-****-*******-5",
        identityStatus: "verified",
        missingRequired: [],
      });
      expect(record(saved.body, "version").reviewStatus).toBe("accepted");
      const versions = await query(
        h,
        `select s3_version_id from doc.document_version where company_id=cast(:company as uuid) and id=cast(:id as uuid)`,
        { id: journey.versionId },
      );
      expect(versions[0]?.s3_version_id).toBeTruthy();
      for (const event of [
        "tenant.created",
        "invitation.created",
        "document.created",
        "document_version.created",
        "document_version.uploaded",
        "document_version.scan_clean",
        "document_version.extracting",
        "extraction.created",
        "field_review.created",
        "document_version.accepted",
        "tenant.updated",
        "document.viewed",
      ])
        expect(await eventCount(h, event), event).toBeGreaterThan(0);
      const savedEvents = await query(
        h,
        `select model_call_ids,field_provenance from audit.audit_event where company_id=cast(:company as uuid) and event_type in ('tenant.updated','document_version.accepted')`,
      );
      for (const event of savedEvents) {
        expect(JSON.stringify(event.model_call_ids)).toContain(
          z.string().parse(record(extracted, "modelCall").id),
        );
        expect(JSON.stringify(event.field_provenance)).toContain("ai_edited");
      }
      expect(
        (
          await query(
            h,
            `select * from audit.verify_chain(cast(:company as uuid))`,
          )
        )[0]?.ok,
      ).toBe(true);
      const replayKey = randomUUID();
      const own = await h.request(
        h.managerA,
        "GET",
        journey.path,
        undefined,
        replayKey,
      );
      expect(own.status).toBe(200);
    });
    it("I-2 wrong company gives exactly one attributed denial per refusal and changes no tenant", async () => {
      const before = await eventCount(h, "policy.denied", h.managerB);
      const snapshot = await query(
        h,
        `select version from party.tenant where company_id=cast(:company as uuid) and id=cast(:id as uuid)`,
        { id: tenantId },
      );
      const responses = [
        await h.request(
          h.managerB,
          "GET",
          `/v1/companies/${h.companyA}/tenants/${tenantId}`,
        ),
        await h.request(
          h.managerB,
          "POST",
          `/v1/companies/${h.companyA}/documents`,
          {
            subjectType: "tenant",
            subjectId: tenantId,
            docType: "emirates_id",
            fileName: "synthetic.jpg",
            contentType: "image/jpeg",
            byteSize: 10240,
            sha256: "ab".repeat(32),
            uploadedVia: "web",
          },
        ),
        await h.request(h.managerB, "PUT", `${journey.path}/fields/name_en`, {
          decision: "edited",
          value: "Synthetic Other",
          sourceViewed: true,
          expectedVersion: 1,
        }),
      ];
      for (const response of responses) {
        expect(response.status).toBe(404);
        expect(response.body.code).toBe("NOT_FOUND");
      }
      expect(await eventCount(h, "policy.denied", h.managerB)).toBe(before + 3);
      expect(
        await query(
          h,
          `select version from party.tenant where company_id=cast(:company as uuid) and id=cast(:id as uuid)`,
          { id: tenantId },
        ),
      ).toEqual(snapshot);
    });
    it("I-3 accountant and linked tenant cannot review; the linked tenant sees only their own record", async () => {
      const before = await eventCount(h, "policy.denied", h.accountantA);
      expect(
        (
          await h.request(
            h.accountantA,
            "POST",
            `/v1/companies/${h.companyA}/tenants`,
            {
              kind: "individual",
              fullNameEn: "Synthetic",
              email: `j3-${randomUUID()}@example.com`,
              preferredLanguage: "en",
            },
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await h.request(
            h.accountantA,
            "PUT",
            `${journey.path}/fields/name_en`,
            {
              decision: "edited",
              value: "Synthetic",
              sourceViewed: true,
              expectedVersion: 1,
            },
          )
        ).status,
      ).toBe(403);
      expect(await eventCount(h, "policy.denied", h.accountantA)).toBe(
        before + 2,
      );
      await linkTenant(h, tenantId);
      const tenantDenials = await eventCount(
        h,
        "policy.denied",
        h.tenantAccount,
      );
      expect(
        (
          await h.request(
            h.tenantAccount,
            "PUT",
            `${journey.path}/fields/name_en`,
            {
              decision: "edited",
              value: "Synthetic",
              sourceViewed: true,
              expectedVersion: 1,
            },
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await h.request(
            h.tenantAccount,
            "POST",
            `/v1/companies/${h.companyA}/tenants/${tenantId}/identity`,
            { documentVersionId: journey.versionId, expectedTenantVersion: 1 },
          )
        ).status,
      ).toBe(403);
      const own = await h.request(
        h.tenantAccount,
        "GET",
        `/v1/companies/${h.companyA}/tenants/${tenantId}`,
      );
      expect(own.status).toBe(200);
      expect(record(own.body, "tenant").eidNumber).toBeNull();
      expect(
        (
          await h.request(
            h.tenantAccount,
            "POST",
            `/v1/companies/${h.companyA}/documents`,
            {
              subjectType: "tenant",
              subjectId: tenantId,
              docType: "passport",
              fileName: "synthetic.jpg",
              contentType: "image/jpeg",
              byteSize: 10240,
              sha256: "ab".repeat(32),
              uploadedVia: "mobile",
            },
          )
        ).status,
      ).toBe(201);
      const other = await newTenant(h);
      expect(
        (
          await h.request(
            h.tenantAccount,
            "GET",
            `/v1/companies/${h.companyA}/tenants/${z.string().parse(other.id)}`,
          )
        ).status,
      ).toBe(404);
      expect(await eventCount(h, "policy.denied", h.tenantAccount)).toBe(
        tenantDenials + 3,
      );
      const listed = await h.request(
        h.managerA,
        "GET",
        `/v1/companies/${h.companyA}/tenants`,
      );
      expect(listed.status).toBe(200);
      expect(JSON.stringify(listed.body)).not.toContain("784197848291635");
    });
    it("I-4 duplicate command replays exactly once and rejects changed content", async () => {
      const key = randomUUID();
      const body = {
        kind: "individual",
        fullNameEn: "Synthetic Duplicate",
        email: `j3-${randomUUID()}@example.com`,
        preferredLanguage: "en",
      };
      const before = await eventCount(h, "tenant.created");
      const path = `/v1/companies/${h.companyA}/tenants`;
      const first = await h.request(h.managerA, "POST", path, body, key);
      const second = await h.request(h.managerA, "POST", path, body, key);
      expect(first.status).toBe(201);
      expect(second.body).toEqual(first.body);
      expect(second.headers.get("Idempotent-Replayed")).toBe("true");
      expect(await eventCount(h, "tenant.created")).toBe(before + 1);
      const conflict = await h.request(
        h.managerA,
        "POST",
        path,
        { ...body, fullNameEn: "Synthetic Changed" },
        key,
      );
      expect(conflict.status).toBe(422);
      expect(conflict.body.code).toBe("IDEMPOTENCY_KEY_REUSED");
    });
    it("I-5 stale decisions and stale tenant saves roll back", async () => {
      const tenant = await newTenant(h);
      pending = await uploadFixture(h, z.string().parse(tenant.id));
      await extractFixture(h, pending);
      const decision = {
        decision: "edited",
        value: "Synthetic First",
        sourceViewed: true,
        expectedVersion: null,
      };
      expect(
        (
          await h.request(
            h.managerA,
            "PUT",
            `${pending.path}/fields/name_en`,
            decision,
          )
        ).status,
      ).toBe(200);
      for (const expectedVersion of [null, 0]) {
        const response = await h.request(
          h.managerA,
          "PUT",
          `${pending.path}/fields/name_en`,
          { ...decision, expectedVersion },
        );
        expect(response.status).toBe(409);
        expect(response.body.code).toBe("STALE_VERSION");
      }
      await h.tx(h.managerA, h.companyA, async (tx) => {
        const updated = await one(
          tx,
          `update party.tenant set full_name_en='Synthetic Concurrent' where company_id=cast(:company as uuid) and id=cast(:id as uuid) returning version`,
          { company: h.companyA, id: pending.tenantId },
        );
        await appendAuditEvent(tx, {
          companyId: h.companyA,
          accountId: h.managerA,
          type: "tenant.updated",
          subjectType: "tenant",
          subjectId: pending.tenantId,
          versionAfter: num(updated, "version"),
        });
      });
      const response = await h.request(
        h.managerA,
        "POST",
        `/v1/companies/${h.companyA}/tenants/${pending.tenantId}/identity`,
        { documentVersionId: pending.versionId, expectedTenantVersion: 1 },
      );
      expect(response.status).toBe(409);
      expect(response.body.code).toBe("STALE_VERSION");
      expect(
        (
          await query(
            h,
            `select full_name_en,version from party.tenant where company_id=cast(:company as uuid) and id=cast(:id as uuid)`,
            { id: pending.tenantId },
          )
        )[0],
      ).toMatchObject({ full_name_en: "Synthetic Concurrent" });
    });
    it("I-6 S3 refuses wrong bytes and completion refuses an absent upload", async () => {
      const fixture = await uploadFixture(h, tenantId, false);
      const wrong = new Uint8Array(fixture.bytes);
      wrong[100] = 1;
      const response = await fetch(fixture.upload.url, {
        method: "PUT",
        headers: fixture.upload.headers,
        body: wrong,
      });
      expect(response.status).toBe(400);
      const errorCode = /<Code>([^<]+)<\/Code>/.exec(
        await response.text(),
      )?.[1];
      expect(errorCode).toBe("BadDigest");
      const completion = await h.request(
        h.managerA,
        "POST",
        `${fixture.path}/upload-complete`,
      );
      expect(completion.status).toBe(409);
      expect(completion.body.code).toBe("UPLOAD_MISSING");
    });
    it("I-7 invalid field, incomplete review and excessive upload size are refused", async () => {
      const invalid = await h.request(
        h.managerA,
        "PUT",
        `${pending.path}/fields/id_number`,
        {
          decision: "edited",
          value: "12345678901234",
          sourceViewed: true,
          expectedVersion: null,
        },
      );
      expect(invalid.status).toBe(422);
      expect(invalid.body).toMatchObject({
        code: "FIELD_INVALID",
        field: "id_number",
      });
      const incomplete = await h.request(
        h.managerA,
        "POST",
        `/v1/companies/${h.companyA}/tenants/${pending.tenantId}/identity`,
        { documentVersionId: pending.versionId, expectedTenantVersion: 2 },
      );
      expect(incomplete.status).toBe(422);
      expect(incomplete.body.code).toBe("REVIEW_INCOMPLETE");
      expect(incomplete.body.fields).toContain("id_number");
      const excessive = await h.request(
        h.managerA,
        "POST",
        `/v1/companies/${h.companyA}/documents`,
        {
          subjectType: "tenant",
          subjectId: tenantId,
          docType: "emirates_id",
          fileName: "synthetic.jpg",
          contentType: "image/jpeg",
          byteSize: 20 * 1024 * 1024 + 1,
          sha256: "ab".repeat(32),
          uploadedVia: "web",
        },
      );
      expect(excessive.status).toBe(422);
      expect(excessive.body.code).toBe("UPLOAD_TOO_LARGE");
    });
    it("I-8 failed provider persists its receipt and permits a human-entered save", async () => {
      const tenant = await newTenant(h);
      const fixture = await uploadFixture(h, z.string().parse(tenant.id));
      h.failProvider = true;
      try {
        const version = await extractFixture(h, fixture);
        expect(version.processingStatus).toBe("extraction_failed");
        expect(record(version, "modelCall").status).toBe("failed");
        const models = await query(
          h,
          `select output_key from ai.model_call where company_id=cast(:company as uuid) and id=cast(:id as uuid)`,
          { id: z.string().parse(record(version, "modelCall").id) },
        );
        const head = await h.deps.storage.head({
          bucket: h.deps.storage.bucket,
          key: z.string().parse(models[0]?.output_key),
        });
        expect(head?.versionId).toBeTruthy();
        await reviewAll(h, fixture, true);
        const saved = await h.request(
          h.managerA,
          "POST",
          `/v1/companies/${h.companyA}/tenants/${fixture.tenantId}/identity`,
          { documentVersionId: fixture.versionId, expectedTenantVersion: 1 },
        );
        expect(saved.status).toBe(200);
        expect(record(saved.body, "tenant").identityStatus).toBe("verified");
      } finally {
        h.failProvider = false;
      }
    });
    it("I-9 scan pending changes nothing and a threat persists rejection with no model call", async () => {
      const fixture = await uploadFixture(h, tenantId);
      const before = h.calls;
      h.scan = null;
      try {
        const pendingScan = await h.request(
          h.managerA,
          "POST",
          `${fixture.path}/extraction`,
        );
        expect(pendingScan.status).toBe(409);
        expect(pendingScan.body.code).toBe("SCAN_PENDING");
        const unchanged = await h.request(h.managerA, "GET", fixture.path);
        expect(record(unchanged.body, "version").processingStatus).toBe(
          "uploaded",
        );
        h.scan = "THREATS_FOUND";
        const deniedBefore = await eventCount(h, "policy.denied", h.managerA);
        const rejectionKey = randomUUID();
        const rejected = await h.request(
          h.managerA,
          "POST",
          `${fixture.path}/extraction`,
          {},
          rejectionKey,
        );
        expect(rejected.status).toBe(409);
        expect(rejected.body.code).toBe("SCAN_REJECTED");
        const replayed = await h.request(
          h.managerA,
          "POST",
          `${fixture.path}/extraction`,
          {},
          rejectionKey,
        );
        expect(replayed.status).toBe(409);
        expect(replayed.headers.get("content-type")).toBe(
          "application/problem+json",
        );
        expect(replayed.headers.get("Idempotent-Replayed")).toBe("true");
        const changed = await h.request(h.managerA, "GET", fixture.path);
        expect(record(changed.body, "version")).toMatchObject({
          processingStatus: "scan_rejected",
          rejectReason: "malware_scan_threats_found",
        });
        expect(h.calls).toBe(before);
        expect(await eventCount(h, "policy.denied", h.managerA)).toBe(
          deniedBefore + 2,
        );
      } finally {
        h.scan = "NO_THREATS_FOUND";
      }
    });
    it("I-10 controlled save used the edited decision and attributed it", async () => {
      const tenant = await query(
        h,
        `select full_name_en from party.tenant where company_id=cast(:company as uuid) and id=cast(:id as uuid)`,
        { id: tenantId },
      );
      expect(tenant[0]?.full_name_en).toBe("Synthetic Reviewed Name");
      const extraction = await query(
        h,
        `select fields->'name_en'->>'value' as value from ai.extraction where company_id=cast(:company as uuid) and document_version_id=cast(:id as uuid)`,
        { id: journey.versionId },
      );
      expect(extraction[0]?.value).toBe("Synthetic Tenant");
      const events = await query(
        h,
        `select field_provenance->>'name_en' as provenance from audit.audit_event where company_id=cast(:company as uuid) and subject_id=cast(:id as uuid) and event_type='tenant.updated' and field_provenance is not null`,
        { id: tenantId },
      );
      expect(events.some((e) => e.provenance === "ai_edited")).toBe(true);
      expect(
        (
          await query(
            h,
            `select * from audit.verify_chain(cast(:company as uuid))`,
          )
        )[0]?.ok,
      ).toBe(true);
    });
    it("database refuses uncovered mutations and app-role model inserts", async () => {
      await expect(
        h.tx(h.managerA, h.companyA, (tx) =>
          rows(
            tx,
            `update party.tenant set full_name_en='Synthetic Uncovered' where company_id=cast(:company as uuid) and id=cast(:id as uuid)`,
            { company: h.companyA, id: tenantId },
          ),
        ),
      ).rejects.toThrow(/AQ002|exactly one covering/);
      await expect(
        h.tx(h.managerA, h.companyA, (tx) =>
          rows(
            tx,
            `insert into ai.model_call(company_id) values(cast(:company as uuid))`,
            { company: h.companyA },
          ),
        ),
      ).rejects.toThrow(/permission denied/);
    });
  },
);
