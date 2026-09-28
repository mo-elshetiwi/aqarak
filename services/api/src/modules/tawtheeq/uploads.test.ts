import { randomUUID } from "node:crypto";
import {
  GetObjectCommand,
  GetObjectTaggingCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dependenciesFromEnvironment } from "./dependencies";
import { documentSchema } from "./repository";
import { inspectUploadedDocument } from "./uploads";

const clients: ReturnType<typeof dependenciesFromEnvironment>[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const deps of clients.splice(0)) deps.s3.destroy();
});

describe("certificate scan inspection", () => {
  it.each([
    ["pending", undefined, true, "uploaded"],
    ["clean", "NO_THREATS_FOUND", true, "scan_clean"],
    ["malware", "THREATS_FOUND", true, "scan_rejected"],
    ["checksum", "NO_THREATS_FOUND", false, "scan_rejected"],
    ["size", "NO_THREATS_FOUND", false, "scan_rejected"],
    ["magic", "NO_THREATS_FOUND", false, "scan_rejected"],
    ["content type", "NO_THREATS_FOUND", false, "scan_rejected"],
  ] as const)(
    "classifies %s evidence from the same pinned version",
    async (kind, scan, integrity, status) => {
      const deps = dependenciesFromEnvironment({
        DATABASE_CLUSTER_ARN: "synthetic-cluster-reference",
        APP_SECRET_ARN: "synthetic-secret-reference",
        DATABASE_NAME: "aqarak_example",
        AWS_REGION: "us-east-1",
      });
      clients.push(deps);
      const document = documentSchema.parse({
        id: randomUUID(),
        document_id: randomUUID(),
        version_no: 1,
        content_type: "image/png",
        byte_size: 16,
        processing_status: "awaiting_upload",
        review_status: "pending_review",
        reject_reason: null,
        created_at: new Date().toISOString(),
        bucket: "synthetic-documents",
        s3_key: "synthetic/certificate",
        s3_version_id: null,
        sha256: "a".repeat(64),
      });
      const requests: unknown[] = [];
      // eslint-disable-next-line @typescript-eslint/no-misused-promises -- I exercise the SDK promise overload, not its callback overload.
      vi.spyOn(deps.s3, "send").mockImplementation((command) => {
        requests.push(command.input);
        if (command instanceof HeadObjectCommand)
          return Promise.resolve({
            VersionId: "pinned-version",
            ContentLength: kind === "size" ? 17 : document.byte_size,
            ContentType:
              kind === "content type"
                ? "application/pdf"
                : document.content_type,
            ChecksumSHA256: Buffer.from(
              kind === "checksum" ? "b".repeat(64) : document.sha256,
              "hex",
            ).toString("base64"),
          });
        if (command instanceof GetObjectCommand)
          return Promise.resolve({
            Body: {
              transformToByteArray: () =>
                Promise.resolve(
                  Buffer.from(
                    kind === "magic" ? "25504446" : "89504e47",
                    "hex",
                  ),
                ),
            },
          });
        if (command instanceof GetObjectTaggingCommand)
          return Promise.resolve({
            TagSet: scan
              ? [{ Key: "GuardDutyMalwareScanStatus", Value: scan }]
              : [],
          });
        throw new Error("Unexpected storage request");
      });
      expect(await inspectUploadedDocument(deps, document)).toEqual({
        status,
        scan,
        integrity,
        versionId: "pinned-version",
      });
      expect(requests).toHaveLength(4);
      for (const request of requests.slice(1))
        expect(request).toMatchObject({
          Bucket: document.bucket,
          Key: document.s3_key,
          VersionId: "pinned-version",
        });
    },
  );
});
