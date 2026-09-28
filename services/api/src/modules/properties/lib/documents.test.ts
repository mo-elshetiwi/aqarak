import { ownerOnboarding, versionItem } from "./read-model";
import { today } from "./gate";
import { randomUUID } from "node:crypto";
import { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import type { Row, Parameter } from "@aqarak/db/data-api";
import { companyId, personAccountId, addDays } from "./domain";
import type { RequestScope } from "./runtime";
import {
  checkDocument,
  acceptDocument,
  rejectDocument,
} from "./document-commands";
import { checkStoredHead, scanDecision } from "./document-check";
import {
  createStorage,
  checksumBase64,
  documentKey,
  putCommand,
  presignOptions,
  type StoragePort,
} from "./storage";
import { versionItemSchema } from "./schemas";
import { uploadSchema } from "./document-schemas";
const png = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 73, 72, 68, 82,
]);
const digest = "a".repeat(64);
function fixture(
  tag: string | null,
  head = png,
): {
  scope: RequestScope;
  storage: StoragePort;
  events: Row[];
  version: Row;
  documentRow: Row;
  versions: Map<string, Row>;
} {
  const c = randomUUID();
  const account = randomUUID();
  const document = randomUUID();
  const id = randomUUID();
  const property = randomUUID();
  const version: Row = {
    id,
    company_id: c,
    document_id: document,
    version: 1,
    version_no: 1,
    processing_status: "awaiting_upload",
    review_status: "pending_review",
    issue_date: null,
    expiry_date: null,
    reject_reason: null,
    s3_key: `test/owners/company/${c}/documents/${document}/${id}`,
    sha256: digest,
    byte_size: "16",
    content_type: "image/png",
    s3_version_id: null,
  };
  const documentRow: Row = {
    id: document,
    version: 1,
    doc_type: "title_deed",
    current_version_id: null,
  };
  const versions = new Map<string, Row>([[id, version]]);
  const events: Row[] = [];
  const scope: RequestScope = {
    params: {
      companyId: c,
      propertyId: property,
      documentId: document,
      versionId: id,
    },
    root: { id: property },
    company: { kind: "management_company" },
    actor: {
      account_id: personAccountId.parse(account),
      company_id: companyId.parse(c),
      roles: ["manager"],
      owner_ids: [],
      tenant_ids: [],
      technician_profile_id: null,
    },
    audit: {
      companyId: c,
      accountId: account,
      role: "manager",
      channel: "web_form",
      key: randomUUID(),
      traceId: randomUUID(),
    },
    tx: {
      execute: vi.fn((sql: string, params: readonly Parameter[] = []) => {
        const values = Object.fromEntries(params.map((p) => [p.name, p.value]));
        if (sql.startsWith("update doc.document_version")) {
          const target = versions.get(String(values.target));
          if (!target) throw new Error("Missing fake version");
          for (const key of [
            "processing_status",
            "scan_result",
            "s3_version_id",
            "review_status",
            "issue_date",
            "expiry_date",
            "reject_reason",
          ])
            if (key in values) target[key] = values[key];
          target.version = Number(target.version) + 1;
          return Promise.resolve({
            rows: [{ ...target }],
            numberOfRecordsUpdated: 1,
          });
        }
        if (sql.startsWith("update doc.document set")) {
          documentRow.current_version_id = values.current_version_id;
          documentRow.version = Number(documentRow.version) + 1;
          return Promise.resolve({
            rows: [{ ...documentRow }],
            numberOfRecordsUpdated: 1,
          });
        }
        if (sql.startsWith("insert into audit.audit_event")) {
          events.push(values);
          return Promise.resolve({ rows: [], numberOfRecordsUpdated: 1 });
        }
        if (sql.includes("from doc.document_version")) {
          const target = versions.get(String(values.version ?? values.id));
          return Promise.resolve({
            rows: target ? [{ ...target }] : [],
            numberOfRecordsUpdated: 0,
          });
        }
        if (sql.includes("from doc.document"))
          return Promise.resolve({
            rows: [{ ...documentRow }],
            numberOfRecordsUpdated: 0,
          });
        throw new Error("Unexpected fake database operation");
      }),
    },
  };
  const storage: StoragePort = {
    presign: vi.fn(),
    head: vi.fn(() =>
      Promise.resolve({
        versionId: "synthetic-object-version",
        byteSize: 16,
        checksumSha256: checksumBase64(digest),
      }),
    ),
    firstBytes: vi.fn(() => Promise.resolve(head)),
    scanTag: vi.fn(() => Promise.resolve(tag)),
  };
  return { scope, storage, events, version, documentRow, versions };
}
describe("AC-4 R5 upload boundary without network", () => {
  it("signs content type, exact content length and checksum for five minutes", async () => {
    const client = new S3Client({
      region: "us-east-1",
      credentials: {
        accessKeyId: "SYNTHETIC_ACCESS_KEY",
        secretAccessKey: "synthetic-fixture-signing-material",
      },
    });
    const key = documentKey({
      prefix: "test/owners/",
      companyId: "company",
      documentId: "document",
      versionId: "version",
    });
    expect(key).toBe("test/owners/company/company/documents/document/version");
    const input = {
      key,
      contentType: "image/png",
      byteSize: 16,
      sha256: digest,
    };
    const command = putCommand("synthetic-bucket", input);
    expect(command.input.ContentLength).toBe(16);
    expect(command.input.ContentType).toBe("image/png");
    expect(command.input.ChecksumSHA256).toBe(checksumBase64(digest));
    expect(presignOptions.expiresIn).toBe(300);
    const signed = await createStorage(client, "synthetic-bucket").presign(
      input,
    );
    const url = new URL(signed.url);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    const headers = url.searchParams.get("X-Amz-SignedHeaders") ?? "";
    for (const header of [
      "content-type",
      "content-length",
      "x-amz-checksum-sha256",
    ])
      expect(headers.includes(header)).toBe(true);
    expect(signed.headers["x-amz-checksum-sha256"]).toBe(
      checksumBase64(digest),
    );
    client.destroy();
  });
  it("refuses a missing object and identifies mismatched size or digest", () => {
    expect(() =>
      checkStoredHead({ sha256: digest, byteSize: 16 }, null),
    ).toThrow("upload not found");
    expect(
      checkStoredHead(
        { sha256: digest, byteSize: 16 },
        {
          versionId: "synthetic",
          byteSize: 17,
          checksumSha256: checksumBase64(digest),
        },
      ).rejected,
    ).toBe(true);
    expect(
      checkStoredHead(
        { sha256: digest, byteSize: 16 },
        { versionId: "synthetic", byteSize: 16, checksumSha256: null },
      ).rejected,
    ).toBe(true);
  });
  it.each([
    "THREATS_FOUND",
    "UNSUPPORTED",
    "ACCESS_DENIED",
    "FAILED",
    "UNEXPECTED_STATUS",
  ])("rejects scan tag %s", (tag) => {
    expect(scanDecision({ contentType: "image/png", head: png, tag })).toEqual({
      status: "scan_rejected",
      result: `malware_scan_${tag.toLowerCase()}`,
    });
  });
  it("content mismatch wins over a clean tag", () => {
    expect(
      scanDecision({
        contentType: "application/pdf",
        head: png,
        tag: "NO_THREATS_FOUND",
      }),
    ).toEqual({ status: "scan_rejected", result: "content_type_mismatch" });
  });
  it("requires a lowercase digest and a positive integer size", () => {
    const input = {
      docType: "title_deed",
      contentType: "image/png",
      byteSize: 16,
      sha256: digest,
    };
    expect(uploadSchema.safeParse(input).success).toBe(true);
    expect(
      uploadSchema.safeParse({ ...input, sha256: digest.toUpperCase() })
        .success,
    ).toBe(false);
    expect(uploadSchema.safeParse({ ...input, byteSize: 1.5 }).success).toBe(
      false,
    );
  });
});
it.each([
  { tag: null, status: "uploaded", count: 1, pending: true },
  { tag: "NO_THREATS_FOUND", status: "scan_clean", count: 2, pending: false },
  { tag: "THREATS_FOUND", status: "scan_rejected", count: 2, pending: false },
])(
  "AC-4 IN21 binds and audits each document check change %#",
  async ({ tag, status, count, pending }) => {
    const f = fixture(tag);
    const response = await checkDocument(f.scope, {}, f.storage);
    expect(
      versionItemSchema.parse(response.body.version).processingStatus,
    ).toBe(status);
    expect(response.body.scanPending).toBe(pending);
    expect(f.events).toHaveLength(count);
    expect(f.version.s3_version_id).toBe("synthetic-object-version");
    expect(f.storage.firstBytes).toHaveBeenCalledWith(
      f.version.s3_key,
      "synthetic-object-version",
    );
    expect(f.storage.scanTag).toHaveBeenCalledWith(
      f.version.s3_key,
      "synthetic-object-version",
    );
    await checkDocument(f.scope, {}, f.storage);
    expect(f.events).toHaveLength(count);
    expect(f.storage.head).toHaveBeenCalledTimes(1);
  },
);
it("D03 AC-4 IN21 checksum and content mismatches expose their scan result", async () => {
  const checksum = fixture(null);
  vi.mocked(checksum.storage.head).mockResolvedValue({
    versionId: "synthetic-object-version",
    byteSize: 17,
    checksumSha256: checksumBase64(digest),
  });
  const rejected = await checkDocument(checksum.scope, {}, checksum.storage);
  expect(versionItemSchema.parse(rejected.body.version).processingStatus).toBe(
    "scan_rejected",
  );
  expect(versionItemSchema.parse(rejected.body.version).scanResult).toBe(
    "checksum_mismatch",
  );
  expect(checksum.events[0]?.reason).toBe("checksum_mismatch");
  expect(checksum.storage.firstBytes).not.toHaveBeenCalled();
  const content = fixture("NO_THREATS_FOUND", Uint8Array.from([0, 1, 2]));
  await checkDocument(content.scope, {}, content.storage);
  expect(content.events.at(-1)?.reason).toBe("content_type_mismatch");
});
it("AC-4 IN4 no object changes no version or audit row inside the rolled-back command", async () => {
  const f = fixture(null);
  vi.mocked(f.storage.head).mockResolvedValue(null);
  await expect(checkDocument(f.scope, {}, f.storage)).rejects.toMatchObject({
    status: 409,
    code: "UPLOAD_NOT_FOUND",
  });
  expect(f.events).toHaveLength(0);
  expect(f.version.version).toBe(1);
});

it("IN21 accepting a newer clean document version supersedes the current version with exact audit coverage", async () => {
  const f = fixture(null);
  f.version.processing_status = "scan_clean";
  f.version.version_no = 2;
  const oldId = randomUUID();
  const old = {
    ...f.version,
    id: oldId,
    version_no: 1,
    review_status: "accepted",
  };
  f.versions.set(oldId, old);
  f.documentRow.current_version_id = oldId;
  const accepted = await acceptDocument(f.scope, {
    expectedVersion: 1,
    issueDate: "2026-01-01",
    expiryDate: "2030-01-01",
  });
  expect(versionItemSchema.parse(accepted.body.version).reviewStatus).toBe(
    "accepted",
  );
  expect(old.review_status).toBe("superseded");
  expect(f.documentRow.current_version_id).toBe(f.version.id);
  expect(f.events.map((row) => row.type)).toEqual([
    "document_version.accepted",
    "document_version.superseded",
    "document.updated",
  ]);
  expect(
    new Set(
      f.events.map(
        (row) =>
          `${String(row.subjectType)}:${String(row.subject)}:${String(row.after)}`,
      ),
    ).size,
  ).toBe(3);
});
it.each([
  "emirates_id",
  "passport",
  "management_agreement",
  "tawtheeq_authorisation",
])(
  "IN4 accepting %s requires expiry and refusals change no version",
  async (type) => {
    const f = fixture(null);
    f.version.processing_status = "scan_clean";
    f.documentRow.doc_type = type;
    await expect(
      acceptDocument(f.scope, { expectedVersion: 1 }),
    ).rejects.toMatchObject({ status: 422, code: "EXPIRY_REQUIRED" });
    expect(f.events).toHaveLength(0);
    expect(f.version.version).toBe(1);
  },
);
it("IN4 review rejects stale versions, unclean scans and expiry before issue", async () => {
  const f = fixture(null);
  await expect(
    acceptDocument(f.scope, { expectedVersion: 2 }),
  ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
  await expect(
    acceptDocument(f.scope, { expectedVersion: 1 }),
  ).rejects.toMatchObject({ code: "SCAN_NOT_CLEAN" });
  f.version.processing_status = "scan_clean";
  await expect(
    acceptDocument(f.scope, {
      expectedVersion: 1,
      issueDate: "2026-12-31",
      expiryDate: "2026-01-01",
    }),
  ).rejects.toMatchObject({ code: "EXPIRY_BEFORE_ISSUE" });
  expect(f.events).toHaveLength(0);
});
it("IN21 document rejection preserves the exact free-text reason", async () => {
  const f = fixture(null);
  const reason = "Synthetic page cannot be reviewed";
  const rejected = await rejectDocument(f.scope, {
    expectedVersion: 1,
    reason,
  });
  const version = versionItemSchema.parse(rejected.body.version);
  expect(version.reviewStatus).toBe("rejected");
  expect(version.rejectReason).toBe(reason);
  expect(f.events).toHaveLength(1);
  expect(f.events[0]?.reason).toBe(reason);
});

it("AC-4 document validity and owner onboarding use accepted unexpired versions", () => {
  const f = fixture(null);
  expect(versionItem({ ...f.version, expiry_date: null }).validity).toBe(
    "valid",
  );
  expect(
    versionItem({ ...f.version, expiry_date: addDays(today(), -1) }).validity,
  ).toBe("expired");
  expect(
    versionItem({ ...f.version, expiry_date: addDays(today(), 60) }).validity,
  ).toBe("expiring_soon");
  expect(ownerOnboarding([], false).status).toBe("incomplete");
  expect(ownerOnboarding([], true).status).toBe("invited");
  const accepted = versionItem({
    ...f.version,
    review_status: "accepted",
    expiry_date: addDays(today(), 90),
  });
  const docs = [
    "emirates_id",
    "title_deed",
    "management_agreement",
    "tawtheeq_authorisation",
  ].map((docType) => ({
    documentId: randomUUID(),
    docType,
    current: accepted,
    latest: accepted,
  }));
  expect(ownerOnboarding(docs, false)).toEqual({
    status: "verified",
    missing: [],
  });
  const pending = {
    documentId: randomUUID(),
    docType: "emirates_id",
    current: null,
    latest: versionItem(f.version),
  };
  expect(ownerOnboarding([pending], true).status).toBe("pending_review");
});
