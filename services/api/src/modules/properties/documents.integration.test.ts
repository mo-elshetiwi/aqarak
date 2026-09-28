import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { estateConfig } from "./lib/config";
import {
  integrationApp,
  seedCompany,
  request,
  query,
  countEvents,
  verifyChain,
  validateDenials,
  type SyntheticCompany,
} from "./lib/integration-fixture";
import { ownerSummarySchema, versionItemSchema } from "./lib/schemas";
import { propertySummarySchema } from "./schemas";
import { uploadResponseSchema } from "./lib/document-schemas";
import { uuid } from "./lib/sql";
import type { z } from "zod";
const app = integrationApp();
// Synthetic one-pixel PNG, containing no person or property information.
const syntheticPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
  "base64",
);
const digest = createHash("sha256").update(syntheticPng).digest("hex");
async function putSynthetic(
  upload: z.infer<typeof uploadResponseSchema>["upload"],
  bytes: Buffer,
): Promise<number> {
  try {
    return (
      await fetch(upload.url, {
        method: "PUT",
        headers: upload.headers,
        body: Uint8Array.from(bytes),
      })
    ).status;
  } catch {
    throw new Error("Synthetic S3 PUT transport failed");
  }
}
describe.runIf(Boolean(estateConfig().clusterArn))(
  "Document version live Data API and S3 acceptance",
  () => {
    let a: SyntheticCompany;
    let b: SyntheticCompany;
    let owner: string;
    let property: string;
    let path: string;
    let uploaded: z.infer<typeof uploadResponseSchema>;
    let current: z.infer<typeof versionItemSchema>;
    beforeAll(async () => {
      a = await seedCompany("management_company");
      b = await seedCompany("management_company");
      const created = await request(app, a, {
        method: "POST",
        body: {
          fullName: { en: "Synthetic document owner", ar: "مالك مستند تجريبي" },
          preferredLanguage: "en",
        },
      });
      owner = ownerSummarySchema.parse(created.body.owner).id;
      const result = await request(app, a, {
        root: "properties",
        method: "POST",
        body: {
          name: { en: "Synthetic document property", ar: "عقار مستند تجريبي" },
          kind: "villa",
          use: "residential",
          ownerId: owner,
          ownerGateOverride: null,
        },
      });
      property = propertySummarySchema.parse(result.body.property).id;
    });
    it("AC-7 IN1 adding owner documents across either company path records one denial", async () => {
      for (const company of [a, b]) {
        const before = await countEvents(company, "policy.denied");
        const response = await request(app, company, {
          account: b.manager,
          method: "POST",
          path: `/${owner}/documents`,
          body: {
            docType: "emirates_id",
            contentType: "image/png",
            byteSize: syntheticPng.length,
            sha256: digest,
          },
        });
        expect(response.status).toBe(404);
        expect(await countEvents(company, "policy.denied")).toBe(before + 1);
      }
      expect(
        await query(
          a,
          "select id from doc.document where company_id=:c and subject_id=:id",
          [uuid("id", owner)],
        ),
      ).toHaveLength(0);
    });
    it("AC-14 R5 IN21 presigned PUT binds exact bytes and records a single S3 object version", async () => {
      const response = await request(app, a, {
        root: "properties",
        method: "POST",
        path: `/${property}/documents`,
        body: {
          docType: "title_deed",
          contentType: "image/png",
          byteSize: syntheticPng.length,
          sha256: digest,
        },
      });
      expect(response.status).toBe(201);
      uploaded = uploadResponseSchema.parse(response.body);
      path = `/${property}/documents/${uploaded.documentId}/versions/${uploaded.documentVersionId}`;
      const before = await request(app, a, {
        root: "properties",
        method: "POST",
        path: `${path}/accept`,
        body: { expectedVersion: 1, expiryDate: "2030-12-31" },
      });
      expect(before.status).toBe(409);
      expect(before.body.code).toBe("SCAN_NOT_CLEAN");
      const missing = await request(app, a, {
        root: "properties",
        method: "POST",
        path: `${path}/check`,
        body: {},
      });
      expect(missing.status).toBe(409);
      expect(missing.body.code).toBe("UPLOAD_NOT_FOUND");
      expect(await putSynthetic(uploaded.upload, syntheticPng)).toBe(200);
      expect(
        await putSynthetic(
          uploaded.upload,
          Buffer.alloc(syntheticPng.length, 0),
        ),
      ).toBeGreaterThanOrEqual(400);
      const checked = await request(app, a, {
        root: "properties",
        method: "POST",
        path: `${path}/check`,
        body: {},
      });
      expect(checked.status).toBe(200);
      current = versionItemSchema.parse(checked.body.version);
      expect(["uploaded", "scan_clean"]).toContain(current.processingStatus);
      const stored = await query(
        a,
        "select s3_version_id,s3_key from doc.document_version where company_id=:c and id=:id",
        [uuid("id", uploaded.documentVersionId)],
      );
      expect(typeof stored[0]?.s3_version_id === "string").toBe(true);
      expect(
        String(stored[0]?.s3_key).startsWith(estateConfig().keyPrefix),
      ).toBe(true);
    });
    it("AC-14 polls the real malware scan tag for up to 120 seconds and accepts the clean version", async () => {
      const deadline = Date.now() + 120000;
      while (current.processingStatus === "uploaded" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const checked = await request(app, a, {
          root: "properties",
          method: "POST",
          path: `${path}/check`,
          body: {},
        });
        expect(checked.status).toBe(200);
        current = versionItemSchema.parse(checked.body.version);
      }
      if (current.processingStatus === "uploaded")
        throw new Error(
          "GuardDutyMalwareScanStatus tag did not arrive within 120 seconds for the synthetic PNG",
        );
      expect(current.processingStatus).toBe("scan_clean");
      const accepted = await request(app, a, {
        root: "properties",
        method: "POST",
        path: `${path}/accept`,
        body: {
          expectedVersion: current.version,
          issueDate: "2026-01-01",
          expiryDate: "2030-12-31",
        },
      });
      expect(accepted.status).toBe(200);
      current = versionItemSchema.parse(accepted.body.version);
      expect(current.reviewStatus).toBe("accepted");
      const repeat = await request(app, a, {
        root: "properties",
        method: "POST",
        path: `${path}/check`,
        body: {},
      });
      expect(repeat.body.version).toEqual(current);
      expect(repeat.body.scanPending).toBe(false);
      expect(await verifyChain(a)).toBe(true);
      expect(await verifyChain(b)).toBe(true);
    });
    it("IN4 document type and size refusals commit only policy.denied", async () => {
      const cases = [
        {
          body: {
            docType: "emirates_id",
            contentType: "image/png",
            byteSize: syntheticPng.length,
            sha256: digest,
          },
          code: "DOC_TYPE_NOT_ALLOWED",
        },
        {
          body: {
            docType: "title_deed",
            contentType: "text/plain",
            byteSize: 12,
            sha256: digest,
          },
          code: "UNSUPPORTED_TYPE",
        },
        {
          body: {
            docType: "title_deed",
            contentType: "image/png",
            byteSize: 20971521,
            sha256: digest,
          },
          code: "UPLOAD_TOO_LARGE",
        },
      ];
      for (const test of cases) {
        const before = await countEvents(a, "policy.denied");
        const response = await request(app, a, {
          root: "properties",
          method: "POST",
          path: `/${property}/documents`,
          body: test.body,
        });
        expect(response.status).toBe(422);
        expect(response.body.code).toBe(test.code);
        expect(await countEvents(a, "policy.denied")).toBe(before + 1);
      }
    });
    it("D01 every recorded denial matches the shared policy schema and every final chain verifies", async () => {
      let count = 0;
      for (const company of [a, b]) {
        count += await validateDenials(company);
        expect(await verifyChain(company)).toBe(true);
      }
      expect(count).toBeGreaterThan(0);
    });
  },
);
