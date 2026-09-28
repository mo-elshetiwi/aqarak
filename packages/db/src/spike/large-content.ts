import { createHash, randomUUID } from "node:crypto";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { withSystemTx } from "../company-tx.ts";
import type { DataApiExecutor } from "../data-api.ts";
import { assertGate, cover, uuid } from "./fixtures.ts";

export interface ObjectPointer {
  bucket: string;
  key: string;
  versionId: string;
  sha256: string;
  byteSize: number;
}
export async function presignContent(
  client: S3Client,
  input: {
    bucket: string;
    key: string;
    bytes: Uint8Array;
    contentType: string;
  },
): Promise<{ url: string; headers: Record<string, string> }> {
  const checksum = createHash("sha256").update(input.bytes).digest("base64");
  const headers = {
    "content-type": input.contentType,
    "content-length": String(input.bytes.byteLength),
    "x-amz-checksum-sha256": checksum,
  };
  const url = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.bytes.byteLength,
      ChecksumSHA256: checksum,
    }),
    {
      expiresIn: 300,
      signableHeaders: new Set(Object.keys(headers)),
      unhoistableHeaders: new Set(["x-amz-checksum-sha256"]),
    },
  );
  const signed =
    new URL(url).searchParams.get("X-Amz-SignedHeaders")?.split(";") ?? [];
  assertGate(
    Object.keys(headers).every((header) => signed.includes(header)),
    "Presigned PUT omitted a required signed header",
  );
  return { url, headers };
}
export async function uploadAndVerify(
  client: S3Client,
  input: { bucket: string; key: string; bytes: Uint8Array },
): Promise<ObjectPointer> {
  const { url, headers } = await presignContent(client, {
    ...input,
    contentType: "text/plain; charset=utf-8",
  });
  const put = await fetch(url, {
    method: "PUT",
    headers,
    body: Buffer.from(input.bytes),
  });
  assertGate(put.ok, `Synthetic upload failed with HTTP ${String(put.status)}`);
  await put.arrayBuffer();
  const different = Buffer.alloc(input.bytes.byteLength, 66);
  const rejected = await fetch(url, {
    method: "PUT",
    headers,
    body: different,
  });
  const rejection = await rejected.text();
  assertGate(
    !rejected.ok &&
      /<Code>(BadDigest|SignatureDoesNotMatch)<\/Code>/u.test(rejection),
    "S3 did not reject changed bytes with a checksum or signature error",
  );
  const head = await client.send(
    new HeadObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      ChecksumMode: "ENABLED",
    }),
  );
  assertGate(
    Boolean(head.VersionId) && head.VersionId !== "null",
    "Documents bucket did not return an object version",
  );
  const versionId = head.VersionId ?? "";
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  assertGate(
    head.ContentLength === input.bytes.byteLength &&
      head.ChecksumSHA256 === Buffer.from(sha256, "hex").toString("base64"),
    "HEAD size or checksum mismatch",
  );
  const object = await client.send(
    new GetObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      VersionId: versionId,
      ChecksumMode: "ENABLED",
    }),
  );
  assertGate(Boolean(object.Body), "Versioned object body missing");
  const bytes = await object.Body?.transformToByteArray();
  assertGate(
    Boolean(bytes) &&
      createHash("sha256")
        .update(bytes ?? new Uint8Array())
        .digest("hex") === sha256,
    "Versioned object checksum mismatch",
  );
  return {
    bucket: input.bucket,
    key: input.key,
    versionId,
    sha256,
    byteSize: input.bytes.byteLength,
  };
}
export async function checkNearLimitRow(
  executor: DataApiExecutor,
  companyId: string,
): Promise<Record<string, unknown>> {
  const documentId = randomUUID();
  const title = "A".repeat(47 * 1024);
  await withSystemTx(executor, { companyId }, async (tx) => {
    await tx.execute(
      "insert into doc.document(id, company_id, subject_type, subject_id, doc_type, title, sensitivity) values (:id, :company, 'company', :company, 'other', :title, 'general')",
      [
        uuid("id", documentId),
        uuid("company", companyId),
        { name: "title", value: title },
      ],
    );
    await cover(tx, companyId, "document", documentId);
  });
  let rowBytes: unknown;
  await withSystemTx(executor, { companyId }, async (tx) => {
    const result = await tx.execute(
      "select title, octet_length(to_jsonb(d)::text)::text as row_bytes from doc.document d where id = :id",
      [uuid("id", documentId)],
    );
    assertGate(
      result.rows[0]?.title === title,
      "Near-limit title did not round trip intact",
    );
    rowBytes = Number(result.rows[0].row_bytes);
    assertGate(
      typeof rowBytes === "number" && rowBytes < 48 * 1024,
      "Near-limit row must remain below 48 KiB",
    );
  });
  return {
    documentId,
    titleBytes: Buffer.byteLength(title),
    rowBytes,
    sha256: createHash("sha256").update(title).digest("hex"),
    intact: true,
  };
}

export async function checkLargeContent(
  executor: DataApiExecutor,
  s3: S3Client,
  options: { companyId: string; bucket: string },
): Promise<Record<string, unknown>> {
  const { companyId } = options;
  const documentId = randomUUID();
  const versionId = randomUUID();
  const nearLimitRow = await checkNearLimitRow(executor, companyId);
  const bytes = Buffer.alloc(100 * 1024, 65);
  let tooLarge = false;
  try {
    await withSystemTx(executor, { companyId }, (tx) =>
      tx.execute(
        "insert into doc.document(company_id, subject_type, subject_id, doc_type, sensitivity, title) values (:company, 'company', :company, 'other', 'general', :title)",
        [
          uuid("company", companyId),
          { name: "title", value: bytes.toString("utf8") },
        ],
      ),
    );
  } catch (error) {
    tooLarge =
      error instanceof Error && /AQ004|Row exceeds 48 KiB/u.test(error.message);
  }
  assertGate(tooLarge, "Oversized document did not raise AQ004");
  const pointer = await uploadAndVerify(s3, {
    bucket: options.bucket,
    key: `c/${companyId}/doc/${documentId}/v/${versionId}/original`,
    bytes,
  });
  await withSystemTx(executor, { companyId }, async (tx) => {
    await tx.execute(
      "insert into doc.document(id, company_id, subject_type, subject_id, doc_type, title, sensitivity) values (:id, :company, 'company', :company, 'other', 'SP2 spike large content pointer', 'general')",
      [uuid("id", documentId), uuid("company", companyId)],
    );
    await cover(tx, companyId, "document", documentId);
    await tx.execute(
      `insert into doc.document_version(id, company_id, document_id, version_no, bucket, s3_key, s3_version_id, sha256, byte_size, content_type, processing_status, uploaded_via)
      values (:id, :company, :document, 1, :bucket, :key, :version, :sha256, cast(:size as bigint), 'text/plain; charset=utf-8', 'uploaded', 'import')`,
      [
        uuid("id", versionId),
        uuid("company", companyId),
        uuid("document", documentId),
        { name: "bucket", value: pointer.bucket },
        { name: "key", value: pointer.key },
        { name: "version", value: pointer.versionId },
        { name: "sha256", value: pointer.sha256 },
        { name: "size", value: String(pointer.byteSize) },
      ],
    );
    await cover(tx, companyId, "document_version", versionId);
  });
  await withSystemTx(executor, { companyId }, async (tx) => {
    const stored = await tx.execute(
      "select bucket, s3_key, s3_version_id, sha256, byte_size::text as byte_size from doc.document_version where id = :id",
      [uuid("id", versionId)],
    );
    const row = stored.rows[0];
    assertGate(
      row?.bucket === pointer.bucket &&
        row.s3_key === pointer.key &&
        row.s3_version_id === pointer.versionId &&
        row.sha256 === pointer.sha256 &&
        row.byte_size === String(pointer.byteSize),
      "Stored large-content pointer differs from HEAD",
    );
  });
  return {
    nearLimitRow,
    oversizedRowBytes: bytes.byteLength,
    oversizedRowRejected: true,
    changedBytesRejected: true,
    pointer,
    documentId,
    documentVersionId: versionId,
  };
}
