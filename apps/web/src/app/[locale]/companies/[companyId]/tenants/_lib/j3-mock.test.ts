import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { beforeEach, expect, it } from "vitest";
import { MOCK_COMPANY_A_ID } from "@/lib/api/mock-fixtures";
import {
  createJ3MockClient,
  seedTenant,
  seedVersion,
  resetJ3Mock,
} from "./j3-mock";
import { tenantSummarySchema } from "./j3-contract";
const access = { sessionId: "synthetic-session", companyId: MOCK_COMPANY_A_ID };
beforeEach(resetJ3Mock);
it("T-6 uses only the API checklist and the screening synthetic image and labels", () => {
  const root = resolve(
    process.cwd(),
    "../../evaluation/datasets/synthetic-docs-v1",
  );
  const labelSchema = z.object({
    doc_id: z.string(),
    synthetic: z.boolean(),
    image_sha256: z.string(),
    fields: z.record(z.string(), z.object({ value: z.string().nullable() })),
  });
  const label = readFileSync(resolve(root, "labels.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => labelSchema.parse(JSON.parse(line)))
    .find((item) => item.doc_id === "emirates_id-028");
  expect(label?.synthetic).toBe(true);
  const splits = z
    .object({ screening: z.array(z.string()) })
    .parse(JSON.parse(readFileSync(resolve(root, "splits.json"), "utf8")));
  expect(splits.screening).toContain("emirates_id-028");
  const bytes = readFileSync(
    resolve(process.cwd(), "public/synthetic/emirates-id-sample.jpg"),
  );
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    label?.image_sha256,
  );
  expect(
    bytes.equals(readFileSync(resolve(root, "images/emirates_id-028.jpg"))),
  ).toBe(true);
  const version = seedVersion();
  expect(version.byteSize).toBe(bytes.length);
  for (const field of version.fields ?? [])
    expect(field.suggestedValue).toBe(label?.fields[field.name]?.value);
  expect(
    version.fields
      ?.filter((field) => field.requiresSourceCheck)
      .map((field) => field.name),
  ).toEqual(["expiry_date", "card_number"]);
  expect(version.modelCall).toMatchObject({
    registryEntry: "mc1_document_extraction/primary",
    promptVersion: "document_extraction@1",
  });
  expect(seedTenant()).toMatchObject({
    fullNameEn: "Fatima Al Dhaheri",
    fullNameAr: "فاطمة الظاهري",
    eidMasked: null,
    eidNumber: null,
  });
  expect(
    seedTenant().checklist.map(({ docType, required }) => ({
      docType,
      required,
    })),
  ).toEqual([
    { docType: "emirates_id", required: true },
    { docType: "passport", required: false },
  ]);
  expect(seedTenant("tenant-2")).toMatchObject({
    fullNameEn: "Omar Farouk",
    fullNameAr: "عمر فاروق",
  });
  expect(
    seedTenant("tenant-2").checklist.every(
      (item) => item.status === "missing" && item.documentId === null,
    ),
  ).toBe(true);
});
it("returns list summaries without detail-only fields", async () => {
  const result = await createJ3MockClient().listTenants(access);
  expect(result.ok).toBe(true);
  if (result.ok)
    for (const tenant of result.tenants)
      expect(tenant).toEqual(tenantSummarySchema.parse(tenant));
});
it("T-4 rejection preserves the upload and leaves tenant identity untouched", async () => {
  const client = createJ3MockClient();
  const version = seedVersion();
  const ref = { documentId: version.documentId, versionId: version.id };
  const rejection = {
    reason: "illegible" as const,
    note: "Synthetic unreadable image",
  };
  const result = await client.rejectVersion(access, ref, rejection, "reject-1");
  expect(result).toMatchObject({
    ok: true,
    version: {
      reviewStatus: "rejected",
      rejectReason: "illegible: Synthetic unreadable image",
    },
  });
  expect(
    await client.rejectVersion(access, ref, rejection, "reject-1"),
  ).toEqual(result);
  expect(await client.getTenant(access, "tenant-1")).toMatchObject({
    ok: true,
    tenant: {
      eidNumber: null,
      fullNameEn: "Fatima Al Dhaheri",
      identityStatus: "missing",
      checklist: [
        { docType: "emirates_id", status: "rejected" },
        { docType: "passport", status: "missing" },
      ],
    },
  });
  expect(await client.getVersion(access, ref)).toMatchObject({
    ok: true,
    version: { reviewStatus: "rejected" },
  });
});
it("creates and invites once per key and refuses another pending invitation", async () => {
  const client = createJ3MockClient();
  const input = {
    kind: "individual" as const,
    fullNameEn: "Synthetic Tenant",
    email: "synthetic@example.com",
    preferredLanguage: "en" as const,
  };
  const created = await client.createTenant(access, input, "create-1");
  expect(await client.createTenant(access, input, "create-1")).toEqual(created);
  if (!created.ok) throw new Error("Expected synthetic tenant");
  expect(created.tenant.phoneE164).toBeNull();
  expect(
    await client.inviteTenant(access, created.tenant.id, "invite-1"),
  ).toMatchObject({ ok: true, invitation: { status: "pending" } });
  expect(
    await client.inviteTenant(access, created.tenant.id, "invite-2"),
  ).toEqual({ ok: false, code: "INVITATION_PENDING" });
});
