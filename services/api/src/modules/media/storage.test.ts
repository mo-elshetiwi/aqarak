import { randomUUID } from "node:crypto";
import { S3Client } from "@aws-sdk/client-s3";
import { expect, it } from "vitest";
import { Problem } from "../maintenance/problem";
import { validateUpload } from "./validation";
import { createStorage, mediaKey } from "./storage";

const body = {
  unitId: randomUUID(),
  kind: "photo",
  contentType: "image/jpeg",
  byteSize: 12,
  sha256: "ab".repeat(32),
};
it.each([
  ["kind", { kind: "video" }, "UNSUPPORTED_TYPE"],
  ["contentType", { contentType: "image/gif" }, "UNSUPPORTED_TYPE"],
  [
    "contentType",
    { kind: "voice_note", contentType: "image/png" },
    "UNSUPPORTED_TYPE",
  ],
  ["byteSize", { byteSize: 20 * 1024 * 1024 + 1 }, "LIMIT_EXCEEDED"],
  [
    "byteSize",
    {
      kind: "voice_note",
      contentType: "audio/mp4",
      byteSize: 26 * 1024 * 1024,
    },
    "LIMIT_EXCEEDED",
  ],
  ["byteSize", { byteSize: 0 }, "LIMIT_EXCEEDED"],
  [
    "durationMs",
    { kind: "voice_note", contentType: "audio/webm", durationMs: 300001 },
    "LIMIT_EXCEEDED",
  ],
  ["durationMs", { durationMs: 1 }, "LIMIT_EXCEEDED"],
  [
    "durationMs",
    { kind: "voice_note", contentType: "audio/mp4", durationMs: -1 },
    "LIMIT_EXCEEDED",
  ],
])("AC-3 rejects invalid media %s with %s", (field, changes, code) => {
  try {
    validateUpload({ ...body, ...changes });
    throw new Error("Expected validation failure");
  } catch (error) {
    expect(error).toBeInstanceOf(Problem);
    if (error instanceof Problem)
      expect(error.body).toMatchObject({ status: 422, code, field });
  }
});
it.each([
  "audio/mp4",
  "audio/m4a",
  "audio/aac",
  "audio/mpeg",
  "audio/wav",
  "audio/webm",
])("accepts voice type %s at both limits", (contentType) => {
  expect(
    validateUpload({
      ...body,
      kind: "voice_note",
      contentType,
      byteSize: 25 * 1024 * 1024,
      durationMs: 300000,
    }).contentType,
  ).toBe(contentType);
});
it("AC-4 signs type, length and checksum using the prefixed media key", async () => {
  const client = new S3Client({
    region: "us-east-1",
    credentials: {
      accessKeyId: "SYNTHETIC",
      secretAccessKey: "synthetic-static-test-secret",
    },
  });
  const key = mediaKey(
    "test/mobile-intake/",
    "synthetic-company",
    "synthetic-media",
  );
  const signed = await createStorage(client).upload({
    bucket: "synthetic-bucket",
    key,
    contentType: body.contentType,
    byteSize: body.byteSize,
    sha256: body.sha256,
  });
  const url = new URL(signed.url);
  expect(url.pathname).toBe(
    "/test/mobile-intake/c/synthetic-company/media/synthetic-media/original",
  );
  expect(url.searchParams.get("X-Amz-SignedHeaders")?.split(";")).toEqual(
    expect.arrayContaining([
      "content-type",
      "content-length",
      "x-amz-checksum-sha256",
    ]),
  );
  expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
  expect(signed.headers).toEqual({
    "content-type": "image/jpeg",
    "content-length": "12",
    "x-amz-checksum-sha256": Buffer.from(body.sha256, "hex").toString("base64"),
  });
  expect(url.searchParams.has("x-amz-checksum-sha256")).toBe(false);
});
