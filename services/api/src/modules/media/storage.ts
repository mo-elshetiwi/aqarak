import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface ObjectLocation {
  bucket: string;
  key: string;
}
export interface UploadObject extends ObjectLocation {
  contentType: string;
  byteSize: number;
  sha256: string;
}
export interface UploadSignature {
  method: "PUT";
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
}
export interface ObjectHead {
  byteSize: number;
  checksum: string | null;
  versionId: string | null;
}
export interface StoragePort {
  read?: (
    location: ObjectLocation & { versionId: string },
  ) => Promise<Uint8Array>;
  upload: (input: UploadObject) => Promise<UploadSignature>;
  head: (location: ObjectLocation) => Promise<ObjectHead | null>;
  download: (
    location: ObjectLocation & { versionId: string },
  ) => Promise<{ url: string; expiresAt: string }>;
}
export function mediaKey(
  prefix: string,
  companyId: string,
  mediaId: string,
): string {
  return `${prefix}c/${companyId}/media/${mediaId}/original`;
}
export function createStorage(client: S3Client): StoragePort {
  return {
    async read(location) {
      const object = await client.send(
        new GetObjectCommand({
          Bucket: location.bucket,
          Key: location.key,
          VersionId: location.versionId,
        }),
      );
      if (!object.Body) throw new Error("Object body is unavailable");
      return object.Body.transformToByteArray();
    },
    async upload(input) {
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
          signableHeaders: new Set([
            "content-type",
            "content-length",
            "x-amz-checksum-sha256",
          ]),
          unhoistableHeaders: new Set(["x-amz-checksum-sha256"]),
        },
      );
      return {
        method: "PUT",
        url,
        headers,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      };
    },
    async head(location) {
      try {
        const result = await client.send(
          new HeadObjectCommand({
            Bucket: location.bucket,
            Key: location.key,
            ChecksumMode: "ENABLED",
          }),
        );
        return {
          byteSize: result.ContentLength ?? -1,
          checksum: result.ChecksumSHA256 ?? null,
          versionId: result.VersionId ?? null,
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
    async download(location) {
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: location.bucket,
          Key: location.key,
          VersionId: location.versionId,
        }),
        { expiresIn: 300 },
      );
      return { url, expiresAt: new Date(Date.now() + 300000).toISOString() };
    },
  };
}
