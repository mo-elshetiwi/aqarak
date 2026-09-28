import {
  GetObjectCommand,
  GetObjectTaggingCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { estateConfig } from "./config";
import { fail } from "./problem";
export interface UploadDeclaration {
  key: string;
  contentType: string;
  byteSize: number;
  sha256: string;
}
export interface StoredHead {
  versionId: string;
  byteSize: number;
  checksumSha256: string | null;
}
export interface StoragePort {
  presign: (input: UploadDeclaration) => Promise<{
    url: string;
    method: "PUT";
    headers: { "Content-Type": string; "x-amz-checksum-sha256": string };
    expiresAt: string;
  }>;
  head: (key: string) => Promise<StoredHead | null>;
  firstBytes: (key: string, versionId: string) => Promise<Uint8Array>;
  scanTag: (key: string, versionId: string) => Promise<string | null>;
}
export function checksumBase64(digest: string): string {
  return Buffer.from(digest, "hex").toString("base64");
}
export function documentKey(input: {
  prefix: string;
  companyId: string;
  documentId: string;
  versionId: string;
}): string {
  return `${input.prefix}company/${input.companyId}/documents/${input.documentId}/${input.versionId}`;
}
export function putCommand(
  bucket: string,
  input: UploadDeclaration,
): PutObjectCommand {
  return new PutObjectCommand({
    Bucket: bucket,
    Key: input.key,
    ContentType: input.contentType,
    ContentLength: input.byteSize,
    ChecksumSHA256: checksumBase64(input.sha256),
  });
}
export const presignOptions = {
  expiresIn: 300,
  signableHeaders: new Set([
    "content-type",
    "content-length",
    "x-amz-checksum-sha256",
  ]),
  unhoistableHeaders: new Set(["x-amz-checksum-sha256"]),
};
export function createStorage(client: S3Client, bucket: string): StoragePort {
  return {
    async presign(input) {
      const url = await getSignedUrl(
        client,
        putCommand(bucket, input),
        presignOptions,
      );
      return {
        url,
        method: "PUT",
        headers: {
          "Content-Type": input.contentType,
          "x-amz-checksum-sha256": checksumBase64(input.sha256),
        },
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      };
    },
    async head(key) {
      try {
        const result = await client.send(
          new HeadObjectCommand({
            Bucket: bucket,
            Key: key,
            ChecksumMode: "ENABLED",
          }),
        );
        if (
          !result.VersionId ||
          result.VersionId === "null" ||
          result.ContentLength === undefined
        )
          fail(503, "UNAVAILABLE");
        return {
          versionId: result.VersionId,
          byteSize: result.ContentLength,
          checksumSha256: result.ChecksumSHA256 ?? null,
        };
      } catch (cause) {
        if (
          cause instanceof S3ServiceException &&
          cause.$metadata.httpStatusCode === 404
        )
          return null;
        throw cause;
      }
    },
    async firstBytes(key, versionId) {
      const result = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          VersionId: versionId,
          Range: "bytes=0-15",
        }),
      );
      if (!result.Body) fail(503, "UNAVAILABLE");
      return result.Body.transformToByteArray();
    },
    async scanTag(key, versionId) {
      const result = await client.send(
        new GetObjectTaggingCommand({
          Bucket: bucket,
          Key: key,
          VersionId: versionId,
        }),
      );
      return (
        result.TagSet?.find((tag) => tag.Key === "GuardDutyMalwareScanStatus")
          ?.Value ?? null
      );
    },
  };
}
let storage: StoragePort | undefined;
export function estateStorage(): StoragePort {
  const config = estateConfig();
  if (!config.bucket) fail(503, "UNAVAILABLE");
  storage ??= createStorage(
    new S3Client(config.region ? { region: config.region } : {}),
    config.bucket,
  );
  return storage;
}
