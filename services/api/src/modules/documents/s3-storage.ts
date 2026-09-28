import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectTaggingCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { DocumentStorage } from "./storage";

export function createS3Storage(options: {
  readonly client: S3Client;
  readonly bucket: string;
  readonly keyPrefix: string;
  readonly now: () => Date;
}): DocumentStorage {
  const { client, now } = options;
  return {
    bucket: options.bucket,
    keyPrefix: options.keyPrefix,
    async presignPut(input) {
      const checksum = Buffer.from(input.sha256, "hex").toString("base64");
      const headers = {
        "content-type": input.contentType,
        "content-length": String(input.byteSize),
        "x-amz-checksum-sha256": checksum,
      };
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: input.bucket,
          Key: input.key,
          ContentType: input.contentType,
          ContentLength: input.byteSize,
          ChecksumSHA256: checksum,
        }),
        {
          expiresIn: 300,
          signableHeaders: new Set(Object.keys(headers)),
          unhoistableHeaders: new Set(["x-amz-checksum-sha256"]),
        },
      );
      return {
        method: "PUT",
        url,
        headers,
        expiresAt: new Date(now().getTime() + 300_000).toISOString(),
      };
    },
    async head(input) {
      try {
        const result = await client.send(
          new HeadObjectCommand({
            Bucket: input.bucket,
            Key: input.key,
            ChecksumMode: "ENABLED",
          }),
        );
        if (!result.VersionId || result.VersionId === "null")
          throw new Error("Versioned storage is required");
        return {
          byteSize: result.ContentLength ?? -1,
          checksum: result.ChecksumSHA256 ?? "",
          versionId: result.VersionId,
        };
      } catch (error) {
        if (
          error instanceof Error &&
          (error.name === "NotFound" || error.name === "NoSuchKey")
        )
          return null;
        throw error;
      }
    },
    async scanStatus(input) {
      const result = await client.send(
        new GetObjectTaggingCommand({
          Bucket: input.bucket,
          Key: input.key,
          VersionId: input.versionId,
        }),
      );
      return (
        result.TagSet?.find((tag) => tag.Key === "GuardDutyMalwareScanStatus")
          ?.Value ?? null
      );
    },
    async getBytes(input) {
      const result = await client.send(
        new GetObjectCommand({
          Bucket: input.bucket,
          Key: input.key,
          VersionId: input.versionId,
        }),
      );
      if (!result.Body) throw new Error("Object body absent");
      return result.Body.transformToByteArray();
    },
    async putReceipt(input, receipt) {
      await client.send(
        new PutObjectCommand({
          Bucket: input.bucket,
          Key: input.key,
          ContentType: "application/json",
          Body: JSON.stringify(receipt),
        }),
      );
    },
    async presignGet(input) {
      return {
        url: await getSignedUrl(
          client,
          new GetObjectCommand({
            Bucket: input.bucket,
            Key: input.key,
            VersionId: input.versionId,
          }),
          { expiresIn: 60 },
        ),
        expiresAt: new Date(now().getTime() + 60_000).toISOString(),
      };
    },
  };
}
